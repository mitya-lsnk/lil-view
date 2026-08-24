//! The `limg://` protocol — how pixels reach the webview.
//!
//! Image bytes never cross the IPC bridge. Tauri serializes a `Vec<u8>` command
//! result as a JSON array of numbers, which for a 40 MB photo means tens of
//! megabytes of text and a stalled webview. A custom scheme hands the same bytes
//! to WebKit's loader as a normal HTTP-shaped response, so `<img src>` streams
//! them the way it would any other resource.
//!
//! Two routes:
//!   `limg://localhost/full?p=<path>&max=<px>`   — the stage
//!   `limg://localhost/thumb?p=<path>&s=<px>`    — filmstrip and grid
//!
//! Formats WebKit already decodes are streamed untouched; the rest go through
//! ImageIO. Everything decoded is memoised, keyed by path *and* mtime so an
//! edited file re-renders instead of serving a stale frame.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use percent_encoding::percent_decode_str;
use tauri::http;
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

/// Formats WKWebView decodes natively — no reason to touch the bytes.
const WEB_NATIVE: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "avif", "svg", "bmp", "dib", "ico",
];

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" | "jpe" | "jfif" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" | "dib" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

// ------------------------------------------------------------------ the cache

/// Byte budget for decoded frames. Big enough to hold a stage image plus a
/// screenful of thumbnails several times over, small enough that paging a
/// folder of RAWs doesn't grow the process without bound.
const CACHE_BUDGET: usize = 256 * 1024 * 1024;

/// A cached frame. Behind an `Arc` so a hit hands out a refcount bump rather
/// than copying megabytes while the lock is held — the grid fires a request per
/// visible thumbnail, and those all queue on this one mutex.
type Frame = (Arc<Vec<u8>>, &'static str);

struct Cache {
    map: HashMap<String, Frame>,
    /// Least-recently-used first.
    order: Vec<String>,
    bytes: usize,
}

impl Cache {
    fn get(&mut self, k: &str) -> Option<Frame> {
        let hit = self.map.get(k)?.clone();
        if let Some(i) = self.order.iter().position(|x| x == k) {
            let k = self.order.remove(i);
            self.order.push(k);
        }
        Some(hit)
    }

    fn put(&mut self, k: String, v: Arc<Vec<u8>>, mime: &'static str) {
        // A single frame larger than the whole budget would evict everything and
        // then itself — serve it, but don't try to keep it.
        if v.len() > CACHE_BUDGET {
            return;
        }
        if let Some((old, _)) = self.map.remove(&k) {
            // Saturating throughout: the byte count is bookkeeping, and if it
            // ever drifts it should cost an early eviction, not a panic on the
            // thread serving an image.
            self.bytes = self.bytes.saturating_sub(old.len());
            self.order.retain(|x| x != &k);
        }
        self.bytes = self.bytes.saturating_add(v.len());
        self.map.insert(k.clone(), (v, mime));
        self.order.push(k);
        while self.bytes > CACHE_BUDGET {
            let Some(oldest) = self.order.first().cloned() else {
                break;
            };
            self.order.remove(0);
            if let Some((v, _)) = self.map.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(v.len());
            }
        }
    }
}

fn cache() -> &'static Mutex<Cache> {
    static C: OnceLock<Mutex<Cache>> = OnceLock::new();
    C.get_or_init(|| {
        Mutex::new(Cache {
            map: HashMap::new(),
            order: Vec::new(),
            bytes: 0,
        })
    })
}

/// Drop every decoded frame. Called from Settings.
pub fn clear_cache() -> usize {
    let mut c = cache().lock().unwrap();
    let freed = c.bytes;
    c.map.clear();
    c.order.clear();
    c.bytes = 0;
    freed
}

pub fn cache_bytes() -> usize {
    cache().lock().unwrap().bytes
}

// ----------------------------------------------------------------- the router

fn query_pairs(uri: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(q) = uri.split_once('?').map(|(_, q)| q) else {
        return out;
    };
    for pair in q.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let v = percent_decode_str(v).decode_utf8_lossy().to_string();
        out.insert(k.to_string(), v);
    }
    out
}

fn respond(responder: UriSchemeResponder, status: u16, mime: &str, body: Vec<u8>) {
    let res = http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, mime)
        // Frames are keyed by mtime on our side, so the webview may hold them
        // as long as it likes; this is what makes paging back instant.
        .header(http::header::CACHE_CONTROL, "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .expect("static response builder");
    responder.respond(res);
}

fn fail(responder: UriSchemeResponder, status: u16, msg: String) {
    respond(responder, status, "text/plain; charset=utf-8", msg.into_bytes());
}

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let uri = request.uri().to_string();
    std::thread::spawn(move || {
        let route = uri
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(&uri)
            .split_once('?')
            .map(|(p, _)| p)
            .unwrap_or("")
            .trim_start_matches("localhost")
            .to_string();
        let q = query_pairs(&uri);

        let Some(path) = q.get("p") else {
            return fail(responder, 400, "нет параметра p".into());
        };
        let path = Path::new(path);

        let thumb = route.ends_with("/thumb");
        let size: u32 = q
            .get(if thumb { "s" } else { "max" })
            .and_then(|v| v.parse().ok())
            .unwrap_or(if thumb { 256 } else { 4096 })
            .clamp(16, 16384);

        let Ok(md) = std::fs::metadata(path) else {
            return fail(responder, 404, format!("{}: нет файла", path.display()));
        };
        if !md.is_file() {
            return fail(responder, 404, format!("{}: не файл", path.display()));
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();

        // Full-size request for something WebKit reads itself: hand over the
        // original file. No decode, no copy beyond the read, no cache entry —
        // this is the common case and it should cost nothing.
        if !thumb && WEB_NATIVE.contains(&ext.as_str()) {
            return match std::fs::read(path) {
                Ok(bytes) => respond(responder, 200, mime_for(&ext), bytes),
                Err(e) => fail(responder, 500, format!("{}: {e}", path.display())),
            };
        }

        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let key = format!(
            "{}|{size}|{mtime}|{}",
            if thumb { "t" } else { "f" },
            path.display()
        );

        // Scoped so the lock is dropped before the body is copied: the response
        // has to own a plain Vec, and that copy must not block the other
        // threads waiting to look something up.
        let hit = cache().lock().unwrap().get(&key);
        if let Some((bytes, mime)) = hit {
            return respond(responder, 200, mime, bytes.to_vec());
        }

        match decode(path, size, thumb) {
            Ok((bytes, mime)) => {
                let bytes = Arc::new(bytes);
                cache().lock().unwrap().put(key, Arc::clone(&bytes), mime);
                respond(responder, 200, mime, bytes.to_vec())
            }
            Err(e) => fail(responder, 415, e),
        }
    });
}

#[cfg(target_os = "macos")]
fn decode(path: &Path, size: u32, thumb: bool) -> Result<(Vec<u8>, &'static str), String> {
    // Thumbnails may reuse the preview the camera embedded; the stage never
    // does, or a RAW would show its soft in-camera JPEG at full size.
    let r = crate::imageio::render(path, size, thumb)?;
    Ok((r.bytes, r.mime))
}

/// Without ImageIO there is no system decoder to lean on. The `image` crate
/// covers the ordinary formats; HEIC, PSD and camera RAW are simply not
/// available off macOS, and saying so beats rendering a broken frame.
#[cfg(not(target_os = "macos"))]
fn decode(path: &Path, size: u32, _thumb: bool) -> Result<(Vec<u8>, &'static str), String> {
    use image::ImageReader;
    let img = ImageReader::open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .with_guessed_format()
        .map_err(|e| format!("{}: {e}", path.display()))?
        .decode()
        .map_err(|_| format!("{}: формат не поддерживается на этой ОС", path.display()))?;
    let img = img.thumbnail(size, size);
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok((out.into_inner(), "image/png"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_path_and_size_from_the_uri() {
        let q = query_pairs("limg://localhost/thumb?p=%2Ftmp%2Fa%20b.heic&s=320");
        assert_eq!(q.get("p").unwrap(), "/tmp/a b.heic");
        assert_eq!(q.get("s").unwrap(), "320");
    }

    #[test]
    fn evicts_oldest_first_and_keeps_the_budget() {
        let mut c = Cache {
            map: HashMap::new(),
            order: Vec::new(),
            bytes: 0,
        };
        let chunk = CACHE_BUDGET / 2 + 1;
        c.put("a".into(), Arc::new(vec![0; chunk]), "image/png");
        c.put("b".into(), Arc::new(vec![0; chunk]), "image/png");
        assert!(c.map.contains_key("b"));
        assert!(!c.map.contains_key("a"), "oldest entry should be evicted");
        assert!(c.bytes <= CACHE_BUDGET);
    }

    #[test]
    fn a_hit_moves_the_entry_to_the_back() {
        let mut c = Cache {
            map: HashMap::new(),
            order: Vec::new(),
            bytes: 0,
        };
        c.put("a".into(), Arc::new(vec![0; 10]), "image/png");
        c.put("b".into(), Arc::new(vec![0; 10]), "image/png");
        c.get("a").unwrap();
        assert_eq!(c.order, vec!["b".to_string(), "a".to_string()]);
    }
}
