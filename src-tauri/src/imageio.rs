//! macOS ImageIO bridge.
//!
//! Everything the system can decode — HEIC, TIFF, PSD, every camera RAW — goes
//! through here, so the viewer inherits Apple's format coverage instead of
//! shipping a decoder per format. WKWebView already handles jpeg/png/gif/webp/
//! avif/svg on its own; `proto.rs` streams those untouched and only falls back
//! to this module for the rest.
//!
//! The whole surface is six ImageIO calls plus a handful of CoreGraphics
//! getters, declared by hand rather than pulling an objc2 binding crate in.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::path::Path;

use core_foundation::array::CFArrayRef;
use core_foundation::base::{CFGetTypeID, CFRelease, CFType, CFTypeID, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::data::CFDataRef;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::{CFURL, CFURLRef};

/// ImageIO's option keys are `CFStringRef` globals; the dictionary builder wants
/// owned `CFString`s. Borrowing under the get rule keeps the globals alive and
/// costs one retain.
unsafe fn key(k: CFStringRef) -> CFString {
    CFString::wrap_under_get_rule(k)
}

fn opts(pairs: Vec<(CFString, CFType)>) -> CFDictionary<CFString, CFType> {
    CFDictionary::from_CFType_pairs(&pairs)
}

type CGImageRef = *const c_void;
type CGImageSourceRef = *const c_void;
type CGImageDestinationRef = *const c_void;

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageSourceCreateWithURL(url: CFURLRef, options: CFDictionaryRef) -> CGImageSourceRef;
    fn CGImageSourceGetCount(isrc: CGImageSourceRef) -> usize;
    fn CGImageSourceCreateThumbnailAtIndex(
        isrc: CGImageSourceRef,
        index: usize,
        options: CFDictionaryRef,
    ) -> CGImageRef;
    fn CGImageSourceCopyPropertiesAtIndex(
        isrc: CGImageSourceRef,
        index: usize,
        options: CFDictionaryRef,
    ) -> CFDictionaryRef;

    fn CGImageDestinationCreateWithData(
        data: CFMutableDataRef,
        ty: CFStringRef,
        count: usize,
        options: CFDictionaryRef,
    ) -> CGImageDestinationRef;
    fn CGImageDestinationAddImage(
        dest: CGImageDestinationRef,
        image: CGImageRef,
        properties: CFDictionaryRef,
    );
    fn CGImageDestinationFinalize(dest: CGImageDestinationRef) -> u8;

    static kCGImageSourceCreateThumbnailFromImageAlways: CFStringRef;
    static kCGImageSourceCreateThumbnailFromImageIfAbsent: CFStringRef;
    static kCGImageSourceCreateThumbnailWithTransform: CFStringRef;
    static kCGImageSourceThumbnailMaxPixelSize: CFStringRef;
    static kCGImageSourceShouldCache: CFStringRef;
    static kCGImageDestinationLossyCompressionQuality: CFStringRef;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGImageRelease(image: CGImageRef);
}

type CFMutableDataRef = *mut c_void;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDataCreateMutable(allocator: CFTypeRef, capacity: isize) -> CFMutableDataRef;
    fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
    fn CFDataGetLength(data: CFDataRef) -> isize;
}

/// Releases a CF/CG object on drop so early returns can't leak.
/// `T` is always a raw pointer here, hence the `Copy` bound.
struct Owned<T: Copy>(T, fn(T));

impl<T: Copy> Owned<T> {
    fn get(&self) -> T {
        self.0
    }
}

impl<T: Copy> Drop for Owned<T> {
    fn drop(&mut self) {
        (self.1)(self.0)
    }
}

fn release_cf(p: *const c_void) {
    if !p.is_null() {
        unsafe { CFRelease(p as CFTypeRef) }
    }
}

fn release_cg_image(p: CGImageRef) {
    if !p.is_null() {
        unsafe { CGImageRelease(p) }
    }
}

/// A decoded frame, already re-encoded into something the webview can render.
pub struct Rendered {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

/// Does the *file* carry transparency? Read from the source properties, which
/// costs a header parse rather than a decode.
fn source_has_alpha(src: CGImageSourceRef) -> bool {
    let dict = unsafe { CGImageSourceCopyPropertiesAtIndex(src, 0, std::ptr::null()) };
    if dict.is_null() {
        return false;
    }
    let dict = Owned(dict as *const c_void, release_cf);
    cf_to_json(dict.get() as CFTypeRef)
        .get("HasAlpha")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn open_source(path: &Path) -> Result<Owned<CGImageSourceRef>, String> {
    let url = CFURL::from_path(path, false)
        .ok_or_else(|| format!("{}: некорректный путь", path.display()))?;
    let src = unsafe { CGImageSourceCreateWithURL(url.as_concrete_TypeRef(), std::ptr::null()) };
    if src.is_null() {
        return Err(format!("{}: не удалось открыть", path.display()));
    }
    let src = Owned(src, release_cf);
    if unsafe { CGImageSourceGetCount(src.get()) } == 0 {
        return Err(format!("{}: изображений не найдено", path.display()));
    }
    Ok(src)
}

/// Decode `path` and hand back web-renderable bytes.
///
/// `max_px` caps the longest side. The thumbnail API is used even for the
/// full-size render because it is the only one that applies the EXIF
/// orientation transform for us — `CGImageSourceCreateImageAtIndex` returns the
/// sensor-order pixels and would show phone photos on their side.
///
/// `prefer_embedded` lets the filmstrip reuse the preview a camera already
/// stored in the file (orders of magnitude faster than decoding a 40 MB RAW);
/// the main stage always forces a real decode so it never shows a soft preview.
pub fn render(path: &Path, max_px: u32, prefer_embedded: bool) -> Result<Rendered, String> {
    let src = open_source(path)?;
    let has_alpha = source_has_alpha(src.get());

    let from_image_key = unsafe {
        if prefer_embedded {
            kCGImageSourceCreateThumbnailFromImageIfAbsent
        } else {
            kCGImageSourceCreateThumbnailFromImageAlways
        }
    };
    let options = unsafe {
        opts(vec![
            (key(from_image_key), CFBoolean::true_value().as_CFType()),
            (
                key(kCGImageSourceCreateThumbnailWithTransform),
                CFBoolean::true_value().as_CFType(),
            ),
            (
                key(kCGImageSourceThumbnailMaxPixelSize),
                CFNumber::from(max_px as i64).as_CFType(),
            ),
            (
                key(kCGImageSourceShouldCache),
                CFBoolean::false_value().as_CFType(),
            ),
        ])
    };

    let img = unsafe {
        CGImageSourceCreateThumbnailAtIndex(src.get(), 0, options.as_concrete_TypeRef())
    };
    if img.is_null() {
        return Err(format!("{}: не удалось декодировать", path.display()));
    }
    let img = Owned(img, release_cg_image);

    // Opaque images go out as JPEG: a 24-megapixel PNG costs seconds to deflate
    // and tens of megabytes to hand over. Only transparency forces PNG.
    //
    // The question has to be asked of the *file*, not of the decoded frame:
    // ImageIO renders thumbnails into a premultiplied-RGBA context, so
    // CGImageGetAlphaInfo reports alpha for every image including a plain JPEG.
    let opaque = !has_alpha;
    let (ty, mime) = if opaque {
        ("public.jpeg", "image/jpeg")
    } else {
        ("public.png", "image/png")
    };

    let bytes = encode(img.get(), ty, if opaque { Some(0.92) } else { None })?;
    Ok(Rendered { bytes, mime })
}

/// Encode a CGImage into `ty` (a UTI such as `public.jpeg`).
fn encode(image: CGImageRef, ty: &str, quality: Option<f64>) -> Result<Vec<u8>, String> {
    let data = unsafe { CFDataCreateMutable(std::ptr::null(), 0) };
    if data.is_null() {
        return Err("нет памяти под буфер".into());
    }
    let data = Owned(data, |p| release_cf(p as *const c_void));

    let ty = CFString::new(ty);
    let dest =
        unsafe { CGImageDestinationCreateWithData(data.get(), ty.as_concrete_TypeRef(), 1, std::ptr::null()) };
    if dest.is_null() {
        return Err("формат не поддерживается для записи".into());
    }
    let dest = Owned(dest, release_cf);

    let props = quality.map(|q| unsafe {
        opts(vec![(
            key(kCGImageDestinationLossyCompressionQuality),
            CFNumber::from(q).as_CFType(),
        )])
    });
    let props_ref = props
        .as_ref()
        .map(|d| d.as_concrete_TypeRef())
        .unwrap_or(std::ptr::null());

    unsafe { CGImageDestinationAddImage(dest.get(), image, props_ref) };
    if unsafe { CGImageDestinationFinalize(dest.get()) } == 0 {
        return Err("не удалось закодировать изображение".into());
    }

    let ptr = unsafe { CFDataGetBytePtr(data.get() as CFDataRef) };
    let len = unsafe { CFDataGetLength(data.get() as CFDataRef) } as usize;
    if ptr.is_null() || len == 0 {
        return Err("пустой результат кодирования".into());
    }
    Ok(unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec())
}

/// Re-encode `path` into `ty` at `quality`, returning the file bytes.
/// Used by "Save as…" — decoding at a generous cap keeps full detail.
pub fn convert(path: &Path, ty: &str, quality: Option<f64>) -> Result<Vec<u8>, String> {
    let src = open_source(path)?;
    let options = unsafe {
        opts(vec![
            (
                key(kCGImageSourceCreateThumbnailFromImageAlways),
                CFBoolean::true_value().as_CFType(),
            ),
            (
                key(kCGImageSourceCreateThumbnailWithTransform),
                CFBoolean::true_value().as_CFType(),
            ),
            (
                key(kCGImageSourceThumbnailMaxPixelSize),
                CFNumber::from(30000i64).as_CFType(),
            ),
        ])
    };
    let img = unsafe {
        CGImageSourceCreateThumbnailAtIndex(src.get(), 0, options.as_concrete_TypeRef())
    };
    if img.is_null() {
        return Err(format!("{}: не удалось декодировать", path.display()));
    }
    let img = Owned(img, release_cg_image);
    encode(img.get(), ty, quality)
}

// ---------------------------------------------------------------- properties

/// The full ImageIO property dictionary (EXIF, TIFF, GPS, IPTC…) as JSON.
pub fn properties(path: &Path) -> Result<serde_json::Value, String> {
    let src = open_source(path)?;
    let dict = unsafe { CGImageSourceCopyPropertiesAtIndex(src.get(), 0, std::ptr::null()) };
    if dict.is_null() {
        return Err(format!("{}: нет метаданных", path.display()));
    }
    let dict = Owned(dict as *const c_void, release_cf);
    Ok(cf_to_json(dict.get() as CFTypeRef))
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetTypeID() -> CFTypeID;
    fn CFNumberGetTypeID() -> CFTypeID;
    fn CFBooleanGetTypeID() -> CFTypeID;
    fn CFArrayGetTypeID() -> CFTypeID;
    fn CFDictionaryGetTypeID() -> CFTypeID;
    fn CFArrayGetCount(array: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: isize) -> *const c_void;
    fn CFDictionaryGetCount(dict: CFDictionaryRef) -> isize;
    fn CFDictionaryGetKeysAndValues(
        dict: CFDictionaryRef,
        keys: *mut *const c_void,
        values: *mut *const c_void,
    );
    fn CFBooleanGetValue(b: CFTypeRef) -> u8;
    fn CFNumberIsFloatType(n: CFTypeRef) -> u8;
    fn CFNumberGetValue(n: CFTypeRef, ty: i32, value: *mut c_void) -> u8;
}

/// Recursively turn a CF value into JSON. Anything we don't recognise becomes
/// its CF description string rather than being dropped — metadata is for
/// reading, so an odd-typed tag is still worth showing.
fn cf_to_json(value: CFTypeRef) -> serde_json::Value {
    use serde_json::Value;
    if value.is_null() {
        return Value::Null;
    }
    let id = unsafe { CFGetTypeID(value) };
    unsafe {
        if id == CFStringGetTypeID() {
            let s = CFString::wrap_under_get_rule(value as CFStringRef);
            return Value::String(s.to_string());
        }
        if id == CFBooleanGetTypeID() {
            return Value::Bool(CFBooleanGetValue(value) != 0);
        }
        if id == CFNumberGetTypeID() {
            if CFNumberIsFloatType(value) != 0 {
                let mut out: f64 = 0.0;
                // kCFNumberFloat64Type = 6
                if CFNumberGetValue(value, 6, &mut out as *mut f64 as *mut c_void) != 0 {
                    return serde_json::Number::from_f64(out)
                        .map(Value::Number)
                        .unwrap_or(Value::Null);
                }
            } else {
                let mut out: i64 = 0;
                // kCFNumberSInt64Type = 4
                if CFNumberGetValue(value, 4, &mut out as *mut i64 as *mut c_void) != 0 {
                    return Value::Number(out.into());
                }
            }
            return Value::Null;
        }
        if id == CFArrayGetTypeID() {
            let arr = value as CFArrayRef;
            let n = CFArrayGetCount(arr);
            let mut out = Vec::with_capacity(n as usize);
            for i in 0..n {
                out.push(cf_to_json(CFArrayGetValueAtIndex(arr, i) as CFTypeRef));
            }
            return Value::Array(out);
        }
        if id == CFDictionaryGetTypeID() {
            let d = value as CFDictionaryRef;
            let n = CFDictionaryGetCount(d) as usize;
            let mut keys: Vec<*const c_void> = vec![std::ptr::null(); n];
            let mut vals: Vec<*const c_void> = vec![std::ptr::null(); n];
            if n > 0 {
                CFDictionaryGetKeysAndValues(d, keys.as_mut_ptr(), vals.as_mut_ptr());
            }
            let mut map = serde_json::Map::with_capacity(n);
            for i in 0..n {
                let k = if CFGetTypeID(keys[i] as CFTypeRef) == CFStringGetTypeID() {
                    CFString::wrap_under_get_rule(keys[i] as CFStringRef).to_string()
                } else {
                    format!("#{i}")
                };
                map.insert(k, cf_to_json(vals[i] as CFTypeRef));
            }
            return Value::Object(map);
        }
    }
    Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Any macOS install ships HEIC wallpapers; decoding one end-to-end proves
    /// the FFI declarations, the orientation transform and the JPEG encoder all
    /// line up. Ignored by default because it depends on system files.
    #[test]
    #[ignore]
    fn decodes_a_system_heic() {
        let dir = Path::new("/System/Library/Desktop Pictures");
        let sample = std::fs::read_dir(dir)
            .expect("desktop pictures")
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().and_then(|e| e.to_str()) == Some("heic"))
            .expect("a .heic wallpaper");

        let out = render(&sample, 1024, false).expect("render");
        assert!(out.bytes.len() > 1000, "suspiciously small encode");
        // A wallpaper has no transparency, so it must come back as JPEG — if
        // this flips to PNG the alpha probe has regressed and every photo is
        // paying for a full deflate.
        assert_eq!(&out.bytes[..2], b"\xff\xd8", "opaque source → JPEG");
        assert_eq!(out.mime, "image/jpeg");

        let props = properties(&sample).expect("properties");
        assert!(props.get("PixelWidth").is_some());
    }
}
