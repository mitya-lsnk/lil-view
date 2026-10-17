/**
 * Viewing preferences. Skin, mode and language live in their own providers
 * (skin.tsx / i18n.tsx); everything else about *how* the viewer behaves is here.
 *
 * Stored in localStorage under one key so a malformed or half-written value can
 * only ever cost the defaults, never a broken startup.
 */

import { useCallback, useEffect, useState } from "react";

export type ZoomMode = "fit" | "actual" | "fitLarge";
export type WheelMode = "zoom" | "pan";
export type SortBy = "name" | "date" | "size";

/**
 * A "send to…" destination, bound to a number key.
 *
 * Nine of them because that's how many digits there are to press; most people
 * will fill one. An empty `path` means the slot is unused — the array always
 * has `SEND_SLOTS` entries so a slot keeps its digit when a neighbour is
 * cleared.
 */
export interface SendSlot {
  path: string;
  /** What to call it in the menu. Falls back to the folder's own name. */
  label: string;
}

export const SEND_SLOTS = 9;

export const emptySlots = (): SendSlot[] =>
  Array.from({ length: SEND_SLOTS }, () => ({ path: "", label: "" }));

export interface Prefs {
  zoom: ZoomMode;
  wheel: WheelMode;
  sort: SortBy;
  sortDesc: boolean;
  slideshowSec: number;
  loop: boolean;
  shuffle: boolean;
  filmstrip: boolean;
  /** Destinations for the number keys. Always `SEND_SLOTS` long. */
  sendSlots: SendSlot[];
  /** Move on to the next picture after sending one. */
  sendAdvances: boolean;
}

export const DEFAULTS: Prefs = {
  // "Fit only if too large" is the least surprising default: small images stay
  // at 1:1 instead of being blown up into mush, big ones get scaled down.
  zoom: "fitLarge",
  // The wheel never pages. A trackpad swipe is dozens of events, so paging on
  // the wheel ran through twenty photos on one flick — that moved to the arrow
  // keys and the toolbar, on purpose.
  wheel: "zoom",
  sort: "name",
  sortDesc: false,
  slideshowSec: 5,
  loop: true,
  shuffle: false,
  filmstrip: true,
  sendSlots: emptySlots(),
  // Sending is something you do *while* going through a folder, so the hand
  // shouldn't have to come back to the arrow key between every two pictures.
  sendAdvances: true,
};

const KEY = "lilview.prefs";

/**
 * Force whatever was stored into exactly `SEND_SLOTS` well-formed entries.
 *
 * The digits are positional: slot 3 must stay on the 3 key even after slot 2 is
 * cleared, so a short, long or ragged array is padded and trimmed rather than
 * used as-is.
 */
function normaliseSlots(stored: unknown): SendSlot[] {
  const out = emptySlots();
  if (!Array.isArray(stored)) return out;
  for (let i = 0; i < SEND_SLOTS; i++) {
    const v = stored[i] as Partial<SendSlot> | undefined;
    if (v && typeof v.path === "string") {
      out[i] = { path: v.path, label: typeof v.label === "string" ? v.label : "" };
    }
  }
  return out;
}

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // Merge rather than replace: a version that adds a preference must not
    // wipe the ones already stored.
    const merged = { ...DEFAULTS, ...parsed };
    // "page" was a wheel mode in the first build. Anything stored that this
    // version no longer understands falls back to the default rather than
    // reaching the viewer as an unhandled value.
    if (merged.wheel !== "zoom" && merged.wheel !== "pan") merged.wheel = DEFAULTS.wheel;
    if (!["fit", "actual", "fitLarge"].includes(merged.zoom)) merged.zoom = DEFAULTS.zoom;
    if (!["name", "date", "size"].includes(merged.sort)) merged.sort = DEFAULTS.sort;
    merged.sendSlots = normaliseSlots(parsed.sendSlots);
    return merged;
  } catch {
    return DEFAULTS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // Storage can be unavailable; the session still works, it just forgets.
    }
  }, [prefs]);

  const set = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
  }, []);

  return { prefs, set };
}
