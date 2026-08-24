/**
 * The Rust side of navigation, typed.
 *
 * `openPath` is the one entry point: hand it a file or a directory and it comes
 * back with the whole folder plus the index to start on. Everything else in the
 * app works on that list and never touches the filesystem itself.
 */

import { call } from "./tauri";
import type { SortBy } from "./settings";

export interface Entry {
  path: string;
  name: string;
  size: number;
  /** Milliseconds since the epoch. */
  mtime: number;
}

export interface Folder {
  dir: string;
  entries: Entry[];
  index: number;
}

export function openPath(path: string, sort: SortBy, desc: boolean): Promise<Folder> {
  return call<Folder>("open_path", { path, sort, desc });
}

export interface ImageInfo {
  path: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** The raw ImageIO dictionary: { Exif: {…}, TIFF: {…}, GPS: {…} }. */
  props: Record<string, unknown>;
}

export function imageInfo(path: string): Promise<ImageInfo> {
  return call<ImageInfo>("image_info", { path });
}

export const trashFile = (path: string) => call<void>("trash_file", { path });
export const moveFile = (path: string, dir: string) => call<string>("move_file", { path, dir });
export const revealInFinder = (path: string) => call<void>("reveal_in_finder", { path });
export const copyPath = (path: string) => call<void>("copy_path_to_clipboard", { path });
export const copyImage = (path: string) => call<void>("copy_image_to_clipboard", { path });

export function saveAs(
  src: string,
  dest: string,
  format: string,
  quality?: number,
): Promise<void> {
  return call<void>("save_as", { src, dest, format, quality });
}

export const takePendingOpen = () => call<string[]>("take_pending_open");
export const cacheBytes = () => call<number>("cache_bytes");
export const clearCache = () => call<number>("clear_cache");

// ------------------------------------------------------------- the lil suite

export interface SuiteApp {
  id: string;
  name: string;
  path: string;
}

/** Suite apps installed on this machine right now. Empty when none are. */
export const suiteApps = () => call<SuiteApp[]>("suite_apps");

export const openInApp = (bundleId: string, path: string) =>
  call<void>("open_in_app", { bundleId, path });

// ------------------------------------------------------------- associations

export interface AssocItem {
  uti: string;
  exts: string[];
  handler: string | null;
  ok: boolean;
}

export interface AssocReport {
  items: AssocItem[];
  total: number;
  ok: number;
  bundleId: string | null;
  bundlePath: string | null;
  installed: boolean;
  blocked: string | null;
}

/**
 * Rust serialises these fields in snake_case; normalise once here so the
 * components can use ordinary camelCase.
 */
interface RawAssocReport {
  items: AssocItem[];
  total: number;
  ok: number;
  bundle_id: string | null;
  bundle_path: string | null;
  installed: boolean;
  blocked: string | null;
}

function normalise(r: RawAssocReport): AssocReport {
  return {
    items: r.items,
    total: r.total,
    ok: r.ok,
    bundleId: r.bundle_id,
    bundlePath: r.bundle_path,
    installed: r.installed,
    blocked: r.blocked,
  };
}

export const assocStatus = () => call<RawAssocReport>("assoc_status").then(normalise);
export const setDefaultHandler = () =>
  call<RawAssocReport>("set_default_image_handler").then(normalise);
export const restoreHandlers = () =>
  call<RawAssocReport>("restore_image_handlers").then(normalise);
