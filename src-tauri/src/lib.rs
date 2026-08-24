#[cfg(target_os = "macos")]
mod assoc;
mod exif;
mod fileops;
#[cfg(target_os = "macos")]
mod imageio;
mod proto;
mod scan;
#[cfg(target_os = "macos")]
mod suite;

use std::sync::Mutex;

use tauri::{Emitter, Manager, RunEvent};

/// Files Finder asked us to open before the webview was ready.
///
/// A cold double-click delivers `RunEvent::Opened` while React is still
/// mounting, so the paths have to wait somewhere. The frontend drains this on
/// mount and listens for `open-files` afterwards; without the buffer, opening
/// the app *by* opening a picture would show an empty window.
#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open(state: tauri::State<'_, Pending>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Bytes currently held in the decoded-frame cache.
#[tauri::command]
fn cache_bytes() -> usize {
    proto::cache_bytes()
}

#[tauri::command]
fn clear_cache() -> usize {
    proto::clear_cache()
}

#[cfg(target_os = "macos")]
macro_rules! command_handler {
    () => {
        tauri::generate_handler![
            take_pending_open,
            cache_bytes,
            clear_cache,
            scan::open_path,
            exif::image_info,
            fileops::trash_file,
            fileops::move_file,
            fileops::reveal_in_finder,
            fileops::copy_path_to_clipboard,
            fileops::copy_image_to_clipboard,
            fileops::save_as,
            assoc::assoc_status,
            assoc::set_default_image_handler,
            assoc::restore_image_handlers,
            suite::suite_apps,
            suite::open_in_app,
        ]
    };
}

/// Off macOS there is no LaunchServices, so the association commands simply
/// don't exist rather than existing and failing.
#[cfg(not(target_os = "macos"))]
macro_rules! command_handler {
    () => {
        tauri::generate_handler![
            take_pending_open,
            cache_bytes,
            clear_cache,
            scan::open_path,
            exif::image_info,
            fileops::trash_file,
            fileops::move_file,
            fileops::reveal_in_finder,
            fileops::copy_path_to_clipboard,
            fileops::copy_image_to_clipboard,
            fileops::save_as,
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Pending::default())
        .register_asynchronous_uri_scheme_protocol("limg", proto::handle)
        .invoke_handler(command_handler!())
        .build(tauri::generate_context!())
        .expect("error while building lil view");

    // `build` + `run` rather than the one-shot `run()`, because `RunEvent` is
    // the only place macOS delivers "open these documents".
    app.run(|app, event| {
        if let RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if paths.is_empty() {
                return;
            }
            app.state::<Pending>()
                .0
                .lock()
                .unwrap()
                .extend(paths.iter().cloned());
            let _ = app.emit("open-files", paths);
        }
    });
}

#[cfg(test)]
mod tests {
    /// `core:default` grants the read-only window queries but none of the
    /// setters. A missing grant is rejected by the ACL with no visible error —
    /// the call just does nothing — so every window mutation the frontend uses
    /// is pinned here. Easy to "tidy" out of the capability file otherwise.
    #[test]
    fn window_mutations_the_frontend_uses_are_granted() {
        let caps: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/capabilities/default.json"
            ))
            .expect("capabilities/default.json"),
        )
        .expect("valid json");

        let granted: Vec<&str> = caps["permissions"]
            .as_array()
            .expect("permissions")
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        for needed in [
            "core:window:allow-set-fullscreen",
            // The window title carries the open file's name, so it isn't
            // duplicated in the toolbar.
            "core:window:allow-set-title",
        ] {
            assert!(
                granted.contains(&needed),
                "{needed} missing — the call would silently do nothing; granted: {granted:?}"
            );
        }
    }
}
