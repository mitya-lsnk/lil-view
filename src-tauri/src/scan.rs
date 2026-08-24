//! Folder listing — the viewer's whole navigation model.
//!
//! Opening a picture means opening the folder it lives in: the file the user
//! double-clicked just decides the starting index. Non-recursive on purpose, so
//! a Downloads folder with a huge subtree still opens instantly.

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

/// Extensions we offer to page through. Superset of what the webview can render
/// on its own — the rest is decoded by `imageio`.
pub const IMAGE_EXTS: &[&str] = &[
    // web-native
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "avif", "svg", "svgz", "bmp", "dib", "ico",
    // system-decoded
    "heic", "heif", "heics", "tif", "tiff", "psd", "icns", "jp2", "j2k", "jpf", "jpx",
    // camera raw
    "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "orf", "raf", "rw2", "pef",
    "srw", "erf", "3fr", "dcr", "kdc", "mrw", "x3f",
];

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Modification time, milliseconds since the epoch.
    pub mtime: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortBy {
    Name,
    Date,
    Size,
}

impl Default for SortBy {
    fn default() -> Self {
        SortBy::Name
    }
}

/// Compare two names the way a person reads them, so `img9` sorts before
/// `img10` instead of after it. Digit runs compare as numbers, everything else
/// compares case-insensitively.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();

    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ac), Some(bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    let an = take_number(&mut ai);
                    let bn = take_number(&mut bi);
                    match an.cmp(&bn) {
                        Ordering::Equal => continue,
                        other => return other,
                    }
                }
                ai.next();
                bi.next();
                let al = ac.to_lowercase().next().unwrap_or(ac);
                let bl = bc.to_lowercase().next().unwrap_or(bc);
                match al.cmp(&bl) {
                    Ordering::Equal => continue,
                    other => return other,
                }
            }
        }
    }
}

fn take_number(it: &mut std::iter::Peekable<std::str::Chars<'_>>) -> u128 {
    let mut n: u128 = 0;
    while let Some(c) = it.peek().copied() {
        if !c.is_ascii_digit() {
            break;
        }
        // Saturate rather than wrap: a 40-digit filename is nonsense input, but
        // it must not silently reorder the list.
        n = n.saturating_mul(10).saturating_add((c as u8 - b'0') as u128);
        it.next();
    }
    n
}

fn read_entries(dir: &Path) -> Result<Vec<Entry>, String> {
    let rd = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut out = Vec::new();
    for e in rd.flatten() {
        let path = e.path();
        if !is_image(&path) {
            continue;
        }
        let md = match e.metadata() {
            Ok(md) if md.is_file() => md,
            _ => continue,
        };
        // Skip the resource-fork stubs and other dot files Finder leaves behind.
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let Some(p) = path.to_str() else { continue };
        out.push(Entry {
            path: p.to_string(),
            name,
            size: md.len(),
            mtime,
        });
    }
    Ok(out)
}

pub fn sort_entries(out: &mut [Entry], by: SortBy, desc: bool) {
    out.sort_by(|a, b| {
        let o = match by {
            SortBy::Name => natural_cmp(&a.name, &b.name),
            // Ties on date/size fall back to the name so the order is stable
            // between rescans instead of following directory order.
            SortBy::Date => a.mtime.cmp(&b.mtime).then_with(|| natural_cmp(&a.name, &b.name)),
            SortBy::Size => a.size.cmp(&b.size).then_with(|| natural_cmp(&a.name, &b.name)),
        };
        if desc {
            o.reverse()
        } else {
            o
        }
    });
}

#[derive(Debug, Serialize)]
pub struct Folder {
    pub dir: String,
    pub entries: Vec<Entry>,
    /// Index of the requested file, or 0 when a bare folder was opened.
    pub index: usize,
}

/// Open whatever the user handed us — a file or a folder — and return the
/// folder's images plus where to start.
#[tauri::command]
pub fn open_path(path: String, sort: Option<SortBy>, desc: Option<bool>) -> Result<Folder, String> {
    let p = PathBuf::from(&path);
    let md = std::fs::metadata(&p).map_err(|e| format!("{path}: {e}"))?;

    let (dir, target) = if md.is_dir() {
        (p.clone(), None)
    } else {
        let dir = p
            .parent()
            .ok_or_else(|| format!("{path}: нет родительской папки"))?
            .to_path_buf();
        (dir, Some(p.clone()))
    };

    let mut entries = read_entries(&dir)?;
    sort_entries(&mut entries, sort.unwrap_or_default(), desc.unwrap_or(false));

    // A file we were asked to open but that the filter skipped (an unusual
    // extension, say) still deserves to be shown — put it in front rather than
    // opening the folder on some unrelated picture.
    let index = match &target {
        Some(t) => {
            let t = t.to_string_lossy();
            match entries.iter().position(|e| e.path == t) {
                Some(i) => i,
                None => {
                    let md = std::fs::metadata(t.as_ref()).ok();
                    entries.insert(
                        0,
                        Entry {
                            path: t.to_string(),
                            name: p
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default(),
                            size: md.as_ref().map(|m| m.len()).unwrap_or(0),
                            mtime: 0,
                        },
                    );
                    0
                }
            }
        }
        None => 0,
    };

    Ok(Folder {
        dir: dir.to_string_lossy().to_string(),
        entries,
        index,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_sort_like_numbers() {
        let mut v = vec!["img10.jpg", "img9.jpg", "img1.jpg", "IMG2.jpg"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["img1.jpg", "IMG2.jpg", "img9.jpg", "img10.jpg"]);
    }

    #[test]
    fn leading_zeros_and_case_dont_reorder() {
        assert_eq!(natural_cmp("a007", "a7"), Ordering::Equal);
        assert_eq!(natural_cmp("Photo.png", "photo.png"), Ordering::Equal);
        assert_eq!(natural_cmp("b", "a10"), Ordering::Greater);
    }

    #[test]
    fn extension_filter_is_case_insensitive() {
        assert!(is_image(Path::new("/x/A.JPG")));
        assert!(is_image(Path::new("/x/raw.CR3")));
        assert!(!is_image(Path::new("/x/notes.txt")));
        assert!(!is_image(Path::new("/x/noext")));
    }

    #[test]
    fn date_sort_falls_back_to_name() {
        let mk = |name: &str, mtime: i64| Entry {
            path: format!("/d/{name}"),
            name: name.into(),
            size: 1,
            mtime,
        };
        let mut v = vec![mk("b.jpg", 5), mk("a.jpg", 5), mk("c.jpg", 1)];
        sort_entries(&mut v, SortBy::Date, false);
        assert_eq!(
            v.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            vec!["c.jpg", "a.jpg", "b.jpg"]
        );
    }
}
