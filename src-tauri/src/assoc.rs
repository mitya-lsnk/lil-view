//! "Open every image with lil view" — one button.
//!
//! macOS keeps default handlers per *content type*, not per extension, and it
//! does not cascade: making us the handler for `public.image` does nothing for
//! `public.jpeg`. So the button walks a concrete list of types and sets each
//! one, then reads every type back and reports what actually stuck. The read-back
//! is the point — LaunchServices happily returns success for a call the system
//! later ignores, and a viewer that lies about this is worse than one without
//! the button.
//!
//! The UTIs are derived from our extension list at runtime rather than
//! hardcoded, so we always ask for the identifier *this* macOS version uses.

#![cfg(target_os = "macos")]

use std::collections::BTreeMap;
use std::ffi::c_void;
use std::path::PathBuf;

use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::{CFURL, CFURLRef};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// Extensions we offer to take over. Mirrors `bundle.fileAssociations` in
/// tauri.conf.json — declaring a type we don't claim in the bundle would set a
/// handler macOS then refuses to use.
const ASSOC_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "tif", "tiff", "bmp", "ico",
    "icns", "svg", "psd", "jp2", "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "sr2", "orf",
    "raf", "rw2", "pef", "srw", "erf", "3fr", "dcr", "kdc", "mrw", "x3f",
];

/// `kLSRolesAll` — claim both the viewer and the editor role, otherwise an app
/// registered as "editor" for the type keeps winning the double-click.
const LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

/// The tag class constant for filename extensions. Passing the literal avoids
/// linking one more global just to name it.
const UT_TAG_CLASS_EXTENSION: &str = "public.filename-extension";

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn UTTypeCreatePreferredIdentifierForTag(
        tag_class: CFStringRef,
        tag: CFStringRef,
        conforming_to: CFStringRef,
    ) -> CFStringRef;
    fn LSSetDefaultRoleHandlerForContentType(
        content_type: CFStringRef,
        role: u32,
        handler_bundle_id: CFStringRef,
    ) -> i32;
    fn LSCopyDefaultRoleHandlerForContentType(content_type: CFStringRef, role: u32) -> CFStringRef;
    fn LSRegisterURL(url: CFURLRef, update: u8) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFBundleGetMainBundle() -> *const c_void;
    fn CFBundleGetIdentifier(bundle: *const c_void) -> CFStringRef;
    fn CFBundleCopyBundleURL(bundle: *const c_void) -> CFURLRef;
}

fn cfstring_take(s: CFStringRef) -> Option<String> {
    if s.is_null() {
        return None;
    }
    let out = unsafe { CFString::wrap_under_create_rule(s) }.to_string();
    Some(out)
}

/// Ask macOS which content type owns `ext`. Unknown extensions come back as a
/// synthesized `dyn.…` identifier, which nothing else on the system recognises —
/// setting a handler for one would be a no-op, so those are dropped.
fn uti_for_extension(ext: &str) -> Option<String> {
    let tag_class = CFString::new(UT_TAG_CLASS_EXTENSION);
    let tag = CFString::new(ext);
    let uti = unsafe {
        UTTypeCreatePreferredIdentifierForTag(
            tag_class.as_concrete_TypeRef(),
            tag.as_concrete_TypeRef(),
            std::ptr::null(),
        )
    };
    let uti = cfstring_take(uti)?;
    if uti.starts_with("dyn.") {
        None
    } else {
        Some(uti)
    }
}

/// UTI → the extensions that map onto it, in a stable order. Several extensions
/// share one type (jpg/jpeg → public.jpeg), and the UI shows the extensions
/// because that is what people recognise.
fn assoc_types() -> BTreeMap<String, Vec<String>> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for ext in ASSOC_EXTS {
        if let Some(uti) = uti_for_extension(ext) {
            map.entry(uti).or_default().push((*ext).to_string());
        }
    }
    map
}

fn current_handler(uti: &str) -> Option<String> {
    let t = CFString::new(uti);
    cfstring_take(unsafe {
        LSCopyDefaultRoleHandlerForContentType(t.as_concrete_TypeRef(), LS_ROLES_ALL)
    })
}

/// Our own bundle identifier, read from the running bundle rather than the
/// config so a renamed or re-signed build can't disagree with itself.
fn bundle_id() -> Option<String> {
    let b = unsafe { CFBundleGetMainBundle() };
    if b.is_null() {
        return None;
    }
    let id = unsafe { CFBundleGetIdentifier(b) };
    if id.is_null() {
        return None;
    }
    // Get rule: the bundle owns this string, so retain before wrapping.
    Some(unsafe { CFString::wrap_under_get_rule(id) }.to_string())
}

fn bundle_path() -> Option<PathBuf> {
    let b = unsafe { CFBundleGetMainBundle() };
    if b.is_null() {
        return None;
    }
    let url = unsafe { CFBundleCopyBundleURL(b) };
    if url.is_null() {
        return None;
    }
    let url = unsafe { CFURL::wrap_under_create_rule(url) };
    url.to_path()
}

/// Re-register the bundle so LaunchServices knows about this exact copy. A build
/// that has never been launched from Finder may not be in the database yet, and
/// setting a handler for an unregistered bundle silently does nothing.
fn register_self() {
    if let Some(p) = bundle_path() {
        if let Some(url) = CFURL::from_path(&p, true) {
            unsafe { LSRegisterURL(url.as_concrete_TypeRef(), 1) };
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AssocItem {
    pub uti: String,
    /// Extensions this type covers, for display: "jpg, jpeg".
    pub exts: Vec<String>,
    /// Bundle id currently handling the type.
    pub handler: Option<String>,
    /// True when `handler` is us.
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssocReport {
    pub items: Vec<AssocItem>,
    pub total: usize,
    pub ok: usize,
    pub bundle_id: Option<String>,
    pub bundle_path: Option<String>,
    /// False for a dev run or an app still sitting in Downloads — the usual
    /// reason a call reports success but nothing changes.
    pub installed: bool,
    /// Set when we can't act at all (running unbundled under `cargo`/`tauri dev`).
    pub blocked: Option<String>,
}

fn report(items: Vec<AssocItem>, id: Option<String>, blocked: Option<String>) -> AssocReport {
    let ok = items.iter().filter(|i| i.ok).count();
    let path = bundle_path();
    let installed = path
        .as_ref()
        .map(|p| p.starts_with("/Applications") || p.starts_with("/System/Applications"))
        .unwrap_or(false);
    AssocReport {
        total: items.len(),
        ok,
        items,
        bundle_id: id,
        bundle_path: path.map(|p| p.to_string_lossy().to_string()),
        installed,
        blocked,
    }
}

fn survey(me: Option<&str>) -> Vec<AssocItem> {
    assoc_types()
        .into_iter()
        .map(|(uti, exts)| {
            let handler = current_handler(&uti);
            let ok = match (&handler, me) {
                (Some(h), Some(me)) => h.eq_ignore_ascii_case(me),
                _ => false,
            };
            AssocItem {
                uti,
                exts,
                handler,
                ok,
            }
        })
        .collect()
}

/// What the system currently does with each image type. Read-only.
#[tauri::command]
pub fn assoc_status() -> AssocReport {
    let me = bundle_id();
    let items = survey(me.as_deref());
    report(items, me, None)
}

/// Claim every image type. Returns the state *after* the attempt, read back from
/// LaunchServices rather than inferred from the return codes.
#[tauri::command]
pub fn set_default_image_handler<R: Runtime>(app: AppHandle<R>) -> AssocReport {
    let Some(me) = bundle_id() else {
        return report(
            survey(None),
            None,
            Some("Приложение запущено не как бандл — соберите .app".into()),
        );
    };

    register_self();

    // Snapshot what handled each type before we touch it, so "вернуть как было"
    // can put it back exactly. Written once and never overwritten by a second
    // run, or the backup would just record ourselves.
    let before: BTreeMap<String, String> = assoc_types()
        .keys()
        .filter_map(|uti| current_handler(uti).map(|h| (uti.clone(), h)))
        .filter(|(_, h)| !h.eq_ignore_ascii_case(&me))
        .collect();
    if !before.is_empty() {
        save_backup(&app, &before);
    }

    let me_cf = CFString::new(&me);
    for uti in assoc_types().keys() {
        let t = CFString::new(uti);
        unsafe {
            LSSetDefaultRoleHandlerForContentType(
                t.as_concrete_TypeRef(),
                LS_ROLES_ALL,
                me_cf.as_concrete_TypeRef(),
            )
        };
    }

    let items = survey(Some(&me));
    report(items, Some(me), None)
}

/// Hand each type back to whatever owned it before the button was pressed.
/// Types with no recorded owner go to Preview, the system default.
#[tauri::command]
pub fn restore_image_handlers<R: Runtime>(app: AppHandle<R>) -> AssocReport {
    let backup = load_backup(&app);
    for uti in assoc_types().keys() {
        let target = backup
            .get(uti)
            .cloned()
            .unwrap_or_else(|| "com.apple.Preview".to_string());
        let t = CFString::new(uti);
        let h = CFString::new(&target);
        unsafe {
            LSSetDefaultRoleHandlerForContentType(
                t.as_concrete_TypeRef(),
                LS_ROLES_ALL,
                h.as_concrete_TypeRef(),
            )
        };
    }
    let me = bundle_id();
    let items = survey(me.as_deref());
    report(items, me, None)
}

// ------------------------------------------------------------------- backup io

fn backup_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("assoc-backup.json"))
}

fn save_backup<R: Runtime>(app: &AppHandle<R>, map: &BTreeMap<String, String>) {
    let Some(p) = backup_path(app) else { return };
    if p.exists() {
        return; // keep the first, pre-lil-view snapshot
    }
    if let Ok(json) = serde_json::to_vec_pretty(map) {
        let _ = std::fs::write(p, json);
    }
}

fn load_backup<R: Runtime>(app: &AppHandle<R>) -> BTreeMap<String, String> {
    backup_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_extension_resolves_to_a_real_type() {
        let types = assoc_types();
        assert!(!types.is_empty());
        // The everyday formats must be present, or the button is pointless.
        for expect in ["public.jpeg", "public.png", "public.tiff"] {
            assert!(types.contains_key(expect), "missing {expect}");
        }
        // jpg and jpeg collapse onto one type — that's the whole reason the map
        // is keyed by UTI rather than by extension.
        let jpeg = &types["public.jpeg"];
        assert!(jpeg.contains(&"jpg".to_string()) && jpeg.contains(&"jpeg".to_string()));
    }

    #[test]
    fn no_dynamic_types_leak_through() {
        assert!(assoc_types().keys().all(|u| !u.starts_with("dyn.")));
    }

    /// The button can only win a type the bundle also claims: LaunchServices
    /// ignores a default handler that doesn't declare the content type in its
    /// Info.plist. This compares what macOS says our extensions are against what
    /// tauri.conf.json declares, so a new extension can't be added to one list
    /// and silently forgotten in the other.
    #[test]
    fn every_derived_type_is_declared_in_the_bundle() {
        let conf: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))
                .expect("tauri.conf.json"),
        )
        .expect("valid json");

        let declared: std::collections::BTreeSet<String> = conf["bundle"]["fileAssociations"]
            .as_array()
            .expect("fileAssociations")
            .iter()
            .flat_map(|a| {
                a["contentTypes"]
                    .as_array()
                    .map(|v| v.to_vec())
                    .unwrap_or_default()
            })
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();

        let derived = assoc_types();
        let missing: Vec<&String> = derived
            .keys()
            .filter(|u| !declared.contains(*u))
            .collect();
        assert!(
            missing.is_empty(),
            "these types are set by the button but not declared in tauri.conf.json: {missing:?}"
        );
    }
}
