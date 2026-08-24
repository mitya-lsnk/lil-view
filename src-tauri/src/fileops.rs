//! Everything that touches the user's files.
//!
//! Two rules here: deletion goes to the Trash (never `unlink`, so a misclick is
//! recoverable), and nothing overwrites an existing file — a name collision gets
//! a suffix instead.

use std::path::{Path, PathBuf};

/// `/a/b/photo.jpg` + an occupied slot → `/a/b/photo 2.jpg`, then `photo 3.jpg`…
///
/// `None` when every suffix up to the cap is taken. The caller must treat that
/// as a failure: returning the colliding name instead would hand back a path
/// that a later `rename` silently overwrites, which is exactly the one thing
/// this function exists to prevent.
fn free_name(dir: &Path, file_name: &str) -> Option<PathBuf> {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return Some(candidate);
    }
    let p = Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = p.extension().and_then(|s| s.to_str());
    for n in 2..10_000 {
        let name = match ext {
            Some(e) => format!("{stem} {n}.{e}"),
            None => format!("{stem} {n}"),
        };
        let c = dir.join(name);
        if !c.exists() {
            return Some(c);
        }
    }
    None
}

/// Move `path` to the Trash. Reversible from Finder, which is the whole point —
/// a viewer where ⌘⌫ destroys an original would be unusable.
#[tauri::command]
pub fn trash_file(path: String) -> Result<(), String> {
    trash_impl(Path::new(&path))
}

#[cfg(target_os = "macos")]
fn trash_impl(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    if !path.exists() {
        return Err(format!("{}: файла нет", path.display()));
    }
    let s = NSString::from_str(&path.to_string_lossy());
    let url = NSURL::fileURLWithPath(&s);
    let fm = NSFileManager::defaultManager();
    fm.trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| format!("{}: {}", path.display(), e.localizedDescription()))
}

#[cfg(not(target_os = "macos"))]
fn trash_impl(path: &Path) -> Result<(), String> {
    Err(format!(
        "{}: удаление в Корзину доступно только на macOS",
        path.display()
    ))
}

/// Move a file into `dir`, returning the new path.
#[tauri::command]
pub fn move_file(path: String, dir: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let dir = PathBuf::from(&dir);
    if !dir.is_dir() {
        return Err(format!("{}: не папка", dir.display()));
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{path}: странное имя файла"))?;
    let dest = free_name(&dir, name)
        .ok_or_else(|| format!("{}: некуда положить, имя занято", dir.display()))?;

    match std::fs::rename(&src, &dest) {
        Ok(()) => {}
        // Renaming across volumes isn't a rename at all — copy, then remove the
        // original only once the copy is on disk.
        Err(_) => {
            std::fs::copy(&src, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
            std::fs::remove_file(&src).map_err(|e| format!("{}: {e}", src.display()))?;
        }
    }
    Ok(dest.to_string_lossy().to_string())
}

/// Select the file in Finder rather than opening it (which would bounce it
/// straight back to us).
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("{path}: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("доступно только на macOS".into())
    }
}

#[tauri::command]
pub fn copy_path_to_clipboard(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;

        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let s = NSString::from_str(&path);
        let ok = unsafe { pb.setString_forType(&s, NSPasteboardTypeString) };
        if ok {
            Ok(())
        } else {
            Err("буфер обмена отказал".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("доступно только на macOS".into())
    }
}

/// Put the picture itself on the clipboard as PNG, so it can be pasted into a
/// chat or a document. Encoded through ImageIO, which means HEIC and RAW paste
/// as ordinary images too.
#[tauri::command]
pub fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG};
        use objc2_foundation::NSData;

        let png = crate::imageio::convert(Path::new(&path), "public.png", None)?;
        let data = NSData::with_bytes(&png);
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let ok = unsafe { pb.setData_forType(Some(&data), NSPasteboardTypePNG) };
        if ok {
            Ok(())
        } else {
            Err("буфер обмена отказал".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("доступно только на macOS".into())
    }
}

/// Re-encode `src` into `dest`. `format` is a plain extension name — the UI
/// offers what ImageIO can write.
#[tauri::command]
pub fn save_as(src: String, dest: String, format: String, quality: Option<u8>) -> Result<(), String> {
    let uti = match format.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "public.jpeg",
        "png" => "public.png",
        "tiff" | "tif" => "public.tiff",
        "heic" => "public.heic",
        "gif" => "com.compuserve.gif",
        "bmp" => "com.microsoft.bmp",
        other => return Err(format!("формат {other} не поддерживается для записи")),
    };
    // PNG/TIFF/GIF ignore the quality knob; passing it anyway is harmless, but
    // sending None keeps the destination properties dictionary empty.
    let lossy = matches!(uti, "public.jpeg" | "public.heic");
    let q = if lossy {
        Some((quality.unwrap_or(90) as f64 / 100.0).clamp(0.05, 1.0))
    } else {
        None
    };

    let bytes = convert_impl(Path::new(&src), uti, q)?;
    std::fs::write(&dest, bytes).map_err(|e| format!("{dest}: {e}"))
}

#[cfg(target_os = "macos")]
fn convert_impl(src: &Path, uti: &str, q: Option<f64>) -> Result<Vec<u8>, String> {
    crate::imageio::convert(src, uti, q)
}

#[cfg(not(target_os = "macos"))]
fn convert_impl(src: &Path, _uti: &str, _q: Option<f64>) -> Result<Vec<u8>, String> {
    Err(format!(
        "{}: конвертация доступна только на macOS",
        src.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collisions_get_a_suffix_instead_of_overwriting() {
        let dir = std::env::temp_dir().join(format!("lilview-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        assert_eq!(free_name(&dir, "a.jpg"), Some(dir.join("a.jpg")));
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        assert_eq!(free_name(&dir, "a.jpg"), Some(dir.join("a 2.jpg")));
        std::fs::write(dir.join("a 2.jpg"), b"x").unwrap();
        assert_eq!(free_name(&dir, "a.jpg"), Some(dir.join("a 3.jpg")));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
