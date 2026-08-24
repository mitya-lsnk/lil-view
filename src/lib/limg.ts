/**
 * URLs for the `limg://` scheme served by src-tauri/src/proto.rs.
 *
 * Everything the viewer displays goes through these two builders. Passing a
 * path straight to `<img src="file://…">` would be blocked by the CSP and would
 * skip the ImageIO fallback, so nothing else should construct image URLs.
 */

/** Custom schemes resolve to `scheme://localhost` on macOS. */
const BASE = "limg://localhost";

function url(route: string, path: string, sizeParam: string, size: number): string {
  return `${BASE}/${route}?p=${encodeURIComponent(path)}&${sizeParam}=${size}`;
}

/**
 * Full-size frame for the stage. `max` caps the longest side of anything that
 * has to be decoded on our side; web-native formats ignore it and stream the
 * original bytes, so the browser still gets full resolution for a JPEG.
 */
export function fullUrl(path: string, max = 4096): string {
  return url("full", path, "max", max);
}

/** Thumbnail for the filmstrip and the grid. */
export function thumbUrl(path: string, size = 256): string {
  return url("thumb", path, "s", size);
}

/**
 * Warm the webview's own cache for the neighbours of the current frame, so
 * arrow-key paging shows the next photo immediately instead of decoding on
 * demand. Returns a canceller: dropped requests matter when someone holds the
 * arrow key down and flies past twenty images.
 */
export function preload(paths: string[], max = 4096): () => void {
  const imgs = paths.map((p) => {
    const img = new Image();
    img.src = fullUrl(p, max);
    return img;
  });
  return () => {
    for (const img of imgs) img.src = "";
  };
}
