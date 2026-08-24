//! Handing a picture over to the rest of the "lil" suite.
//!
//! lil view deliberately doesn't edit. When the sibling app that *does* edit is
//! installed, the open photo should be one click away from it — and when it
//! isn't installed, the option shouldn't exist at all rather than failing on
//! click. So the frontend asks the system what's actually here.

#![cfg(target_os = "macos")]

use std::ffi::c_void;

use core_foundation::array::CFArrayRef;
use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::{CFURL, CFURLRef};
use serde::Serialize;

/// Suite members we know how to hand a file to, in menu order.
/// `(bundle id, display name)`.
///
/// `com.lil.image` is what lil edit shipped under before the rename. It stays
/// here so a copy installed before then is still found — a hand-off that
/// silently stops working after an unrelated update is worse than one extra
/// line.
const SUITE: &[(&str, &str)] = &[
    ("com.lil.edit", "lil edit"),
    ("com.lil.image", "lil edit"),
];

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    /// Every copy of an app with this identifier that LaunchServices knows
    /// about. NULL when none is installed.
    fn LSCopyApplicationURLsForBundleIdentifier(
        bundle_id: CFStringRef,
        out_error: *mut CFTypeRef,
    ) -> CFArrayRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: isize) -> *const c_void;
}

#[derive(Debug, Clone, Serialize)]
pub struct SuiteApp {
    pub id: String,
    pub name: String,
    pub path: String,
}

fn installed_at(bundle_id: &str) -> Option<String> {
    let id = CFString::new(bundle_id);
    let mut err: CFTypeRef = std::ptr::null();
    let arr = unsafe { LSCopyApplicationURLsForBundleIdentifier(id.as_concrete_TypeRef(), &mut err) };
    if !err.is_null() {
        unsafe { CFRelease(err) };
    }
    if arr.is_null() {
        return None;
    }

    let count = unsafe { CFArrayGetCount(arr) };
    // Several copies can be registered (a build folder, a download, /Applications).
    // Take the first, which LaunchServices orders by preference.
    let path = if count > 0 {
        let url = unsafe { CFArrayGetValueAtIndex(arr, 0) } as CFURLRef;
        if url.is_null() {
            None
        } else {
            unsafe { CFURL::wrap_under_get_rule(url) }
                .to_path()
                .map(|p| p.to_string_lossy().to_string())
        }
    } else {
        None
    };
    unsafe { CFRelease(arr as CFTypeRef) };
    path
}

/// Which suite apps are on this machine right now. Called when the actions menu
/// opens, so an app installed mid-session shows up without a restart.
#[tauri::command]
pub fn suite_apps() -> Vec<SuiteApp> {
    SUITE
        .iter()
        .filter_map(|(id, name)| {
            installed_at(id).map(|path| SuiteApp {
                id: (*id).to_string(),
                name: (*name).to_string(),
                path,
            })
        })
        .collect()
}

/// Open `path` with a specific app. Addressed by bundle id rather than by the
/// path we found, so moving the other app between the check and the click still
/// works.
#[tauri::command]
pub fn open_in_app(bundle_id: String, path: String) -> Result<(), String> {
    if !SUITE.iter().any(|(id, _)| *id == bundle_id) {
        // Only ever hand a file to a known suite member: this command takes a
        // bundle id from the frontend, and it should not become a way to launch
        // an arbitrary application.
        return Err(format!("{bundle_id}: не приложение из набора lil"));
    }
    std::process::Command::new("/usr/bin/open")
        .arg("-b")
        .arg(&bundle_id)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_identifier_is_not_installed() {
        assert!(installed_at("com.example.definitely-not-here").is_none());
    }

    #[test]
    fn finder_is_always_installed() {
        // A fixed point to prove the LaunchServices lookup actually works,
        // rather than the suite check passing because it always returns None.
        let p = installed_at("com.apple.finder").expect("Finder");
        assert!(p.ends_with(".app"), "unexpected path: {p}");
    }

    #[test]
    fn open_in_app_refuses_apps_outside_the_suite() {
        assert!(open_in_app("com.apple.Terminal".into(), "/tmp/x".into()).is_err());
    }
}
