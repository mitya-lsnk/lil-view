//! Shot data for the info panel.
//!
//! ImageIO already parses EXIF, TIFF, GPS and IPTC for every format it reads, so
//! there is no separate metadata crate here — we hand the whole property
//! dictionary to the frontend and let it pick the rows worth showing. Dimensions
//! come from the same call, which is why the panel can label an image before the
//! pixels have finished decoding.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ImageInfo {
    pub path: String,
    pub bytes: u64,
    pub width: Option<u64>,
    pub height: Option<u64>,
    /// The raw ImageIO dictionary: `{Exif:{…}, TIFF:{…}, GPS:{…}, …}`.
    pub props: serde_json::Value,
}

#[tauri::command]
pub fn image_info(path: String) -> Result<ImageInfo, String> {
    let p = std::path::Path::new(&path);
    let bytes = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let props = properties(p)?;
    let width = props.get("PixelWidth").and_then(|v| v.as_u64());
    let height = props.get("PixelHeight").and_then(|v| v.as_u64());
    Ok(ImageInfo {
        path,
        bytes,
        width,
        height,
        props,
    })
}

#[cfg(target_os = "macos")]
fn properties(p: &std::path::Path) -> Result<serde_json::Value, String> {
    crate::imageio::properties(p)
}

#[cfg(not(target_os = "macos"))]
fn properties(_p: &std::path::Path) -> Result<serde_json::Value, String> {
    Ok(serde_json::Value::Object(Default::default()))
}
