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
 * demand.
 *
 * There is deliberately no cancellation. Assigning `img.src = ""` does not
 * abort anything — an empty string resolves against the document URL, so the
 * browser goes and fetches the page instead. Letting the elements fall out of
 * scope is both simpler and cheaper: the responses are already on their way and
 * land in the webview's cache, which is the whole point.
 */
export function preload(paths: string[], max = 4096): void {
  for (const p of paths) {
    const img = new Image();
    img.src = fullUrl(p, max);
  }
}
