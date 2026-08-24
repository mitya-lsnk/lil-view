import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { fullUrl } from "../lib/limg";
import { useStrings } from "../lib/i18n";
import type { WheelMode, ZoomMode } from "../lib/settings";

/**
 * The picture, and everything a pointer can do to it.
 *
 * The view (scale, pan, rotation) lives in a ref and is written straight to the
 * element's `style.transform`, not in React state. Two reasons, both learned the
 * hard way:
 *
 *  - A trackpad emits wheel events faster than React commits. With the view in
 *    state, every event in a burst reads the same stale scale and pan, so the
 *    zoom accumulates wrongly and the anchor point drifts.
 *  - Re-rendering the app on every wheel event also re-renders the filmstrip,
 *    which can hold thousands of thumbnails.
 *
 * The transform is `translate(pan) rotate scale` about the element's centre, and
 * the element is laid out centred in the stage. Keep `transform-origin` at 50% —
 * every offset below assumes the centre. It was `0 0` once, and the image
 * scaled away from its own top-left corner off the edge of the window.
 */

export interface StageHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  actual(): void;
  rotate(dir: -1 | 1): void;
}

interface Props {
  path: string | null;
  /** Bumped by the parent to force a reload of the same path. */
  reloadKey?: number;
  zoomMode: ZoomMode;
  wheelMode: WheelMode;
  onZoom: (scale: number) => void;
  onNaturalSize: (w: number, h: number) => void;
  onToggleImmersive: () => void;
}

/** Formats that can carry transparency and therefore want a checkerboard. */
const ALPHA_EXTS = ["png", "gif", "webp", "avif", "svg", "svgz", "tif", "tiff", "psd", "ico", "icns"];

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;

/**
 * Zoom sensitivity, per pixel of wheel delta, fed through `exp()`.
 *
 * A trackpad swipe is dozens of events of a few pixels each, so the per-event
 * step has to be small or one flick runs 60% → 500%. A mouse notch is ~100px in
 * one event and lands on a comfortable ~22%. Pinch deltas are far smaller than
 * scroll deltas, hence its own constant.
 */
const WHEEL_ZOOM_RATE = 0.0025;
const PINCH_ZOOM_RATE = 0.02;
/** No single event may do more than this, whatever the OS reports. */
const MAX_STEP = 1.25;

interface View {
  scale: number;
  x: number;
  y: number;
  rot: number;
}

export const Stage = forwardRef<StageHandle, Props>(function Stage(
  { path, reloadKey, zoomMode, wheelMode, onZoom, onNaturalSize, onToggleImmersive },
  ref,
) {
  const s = useStrings();
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = useRef<View>({ scale: 1, x: 0, y: 0, rot: 0 });
  const nat = useRef<{ w: number; h: number } | null>(null);
  const reported = useRef(1);

  /** Size on screen at a given scale — a quarter turn swaps the axes. */
  const sizeAt = useCallback((scale: number, rot: number) => {
    const n = nat.current;
    if (!n) return { w: 0, h: 0 };
    const swap = rot % 180 !== 0;
    return { w: (swap ? n.h : n.w) * scale, h: (swap ? n.w : n.h) * scale };
  }, []);

  const fitScale = useCallback(
    (rot: number) => {
      const box = boxRef.current;
      const n = nat.current;
      if (!box || !n) return 1;
      const swap = rot % 180 !== 0;
      const iw = swap ? n.h : n.w;
      const ih = swap ? n.w : n.h;
      if (!iw || !ih || !box.clientWidth || !box.clientHeight) return 1;
      return Math.min(box.clientWidth / iw, box.clientHeight / ih);
    },
    [],
  );

  /** Write the current view to the DOM. The only place that touches style. */
  const paint = useCallback(() => {
    const img = imgRef.current;
    const box = boxRef.current;
    const v = view.current;
    if (img) {
      img.style.transform = `translate(${v.x}px, ${v.y}px) rotate(${v.rot}deg) scale(${v.scale})`;
      img.classList.toggle("pixelated", v.scale > 2);
    }
    if (box) {
      const d = sizeAt(v.scale, v.rot);
      const pannable = d.w > box.clientWidth + 1 || d.h > box.clientHeight + 1;
      box.classList.toggle("grabbable", pannable);
    }
    // The status bar only needs a rounded percentage, so skip the re-render
    // unless the number it would show actually changed.
    if (Math.abs(v.scale - reported.current) > 0.0005) {
      reported.current = v.scale;
      onZoom(v.scale);
    }
  }, [onZoom, sizeAt]);

  /**
   * Apply a change to the view, keeping the image from being dragged out of
   * sight. When it fits, it is pinned to the centre.
   */
  const commit = useCallback(
    (next: Partial<View>) => {
      const v = view.current;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale ?? v.scale));
      const rot = next.rot ?? v.rot;
      let x = next.x ?? v.x;
      let y = next.y ?? v.y;

      const box = boxRef.current;
      if (box) {
        const d = sizeAt(scale, rot);
        const maxX = Math.max(0, (d.w - box.clientWidth) / 2);
        const maxY = Math.max(0, (d.h - box.clientHeight) / 2);
        x = Math.min(maxX, Math.max(-maxX, x));
        y = Math.min(maxY, Math.max(-maxY, y));
      }

      view.current = { scale, x, y, rot };
      paint();
    },
    [paint, sizeAt],
  );

  /**
   * Scale by `factor`, keeping the point under `focus` (measured from the centre
   * of the stage) fixed. Without the focus term the image slides away from
   * wherever you were pointing, which is what makes wheel-zoom feel broken.
   */
  const zoomBy = useCallback(
    (factor: number, focus?: { x: number; y: number }) => {
      const v = view.current;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const f = scale / v.scale; // recompute after clamping, or the anchor drifts at the limits
      if (!focus) {
        commit({ scale, x: v.x * f, y: v.y * f });
        return;
      }
      commit({
        scale,
        x: focus.x - f * (focus.x - v.x),
        y: focus.y - f * (focus.y - v.y),
      });
    },
    [commit],
  );

  const doFit = useCallback(() => {
    commit({ scale: fitScale(view.current.rot), x: 0, y: 0 });
  }, [commit, fitScale]);

  const doActual = useCallback(() => commit({ scale: 1 }), [commit]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      fit: doFit,
      actual: doActual,
      rotate: (dir) => {
        const rot = (((view.current.rot + dir * 90) % 360) + 360) % 360;
        // Turning changes the proportions, so the old scale means nothing —
        // re-fit, unless the user was deliberately inspecting at 1:1.
        const scale = view.current.scale === 1 ? 1 : fitScale(rot);
        commit({ rot, scale, x: 0, y: 0 });
      },
    }),
    [commit, doActual, doFit, fitScale, zoomBy],
  );

  // ---------------------------------------------------------------- loading

  /**
   * Take the size from the element and choose the opening scale.
   *
   * Called from `onLoad` *and* from the path effect, because WKWebView does not
   * reliably fire `load` for a resource that is already in its cache — and the
   * app preloads the neighbouring frames, so every image after the first one is
   * cached. Trusting the event alone left `busy` stuck on and the image
   * `visibility: hidden` forever: the title changed, the progress hairline ran,
   * and the stage stayed a flat colour.
   */
  const applyLoaded = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // The ref is set before the state so the paint below — which happens in this
    // same tick — already knows the image's size.
    nat.current = { w, h };
    setNatural({ w, h });
    setBusy(false);
    onNaturalSize(w, h);

    const f = fitScale(0);
    const scale = zoomMode === "actual" ? 1 : zoomMode === "fit" ? f : Math.min(1, f);
    view.current = { scale, x: 0, y: 0, rot: 0 };
    paint();
  }, [fitScale, onNaturalSize, paint, zoomMode]);

  // Held in a ref so the reset effect below can call the latest version without
  // naming it as a dependency. Listing it there re-ran the reset on every render
  // of the parent — and the parent re-renders on every zoom report, so a pinch
  // snapped straight back to the opening scale.
  const applyLoadedRef = useRef(applyLoaded);
  applyLoadedRef.current = applyLoaded;

  /** A new image: forget the old view, then take the new one's size. */
  useEffect(() => {
    nat.current = null;
    setNatural(null);
    setError(null);
    setBusy(!!path);
    view.current = { scale: 1, x: 0, y: 0, rot: 0 };

    // `src` was already updated in the commit this effect follows. If the bytes
    // were cached the element is complete right now and no `load` event is
    // coming, so read it directly rather than waiting for one.
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) applyLoadedRef.current();
  }, [path, reloadKey]);

  // Re-fit on resize, but only while the image is still at fit scale: once it
  // has been zoomed by hand, resizing the window must not throw that away.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      const v = view.current;
      const wasFit = Math.abs(v.scale - fitScale(v.rot)) < 0.002;
      commit(wasFit ? { scale: fitScale(v.rot), x: 0, y: 0 } : {});
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [commit, fitScale]);

  // ---------------------------------------------------------------- pointer

  // Registered by hand rather than via onWheel, because React attaches its
  // listeners passively and this one has to call preventDefault to stop the
  // webview treating a two-finger swipe as a back-navigation.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!nat.current) return;

      // Firefox and some mice report deltas in lines or pages, not pixels.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;

      // macOS sends a pinch as a wheel event with ctrlKey set. Pinch is always
      // zoom, whatever the scroll preference says.
      const pinch = e.ctrlKey;
      if (pinch || wheelMode === "zoom") {
        const r = box.getBoundingClientRect();
        const focus = {
          x: e.clientX - (r.left + r.width / 2),
          y: e.clientY - (r.top + r.height / 2),
        };
        const rate = pinch ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
        const raw = Math.exp(-dy * rate);
        zoomBy(Math.min(MAX_STEP, Math.max(1 / MAX_STEP, raw)), focus);
        return;
      }

      // Otherwise the swipe pans. When the image fits, `commit` clamps this to
      // nothing — paging is on the arrow keys and the toolbar, deliberately, so
      // a stray swipe can't run through twenty photos.
      const v = view.current;
      commit({ x: v.x - dx, y: v.y - dy });
    };

    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [commit, wheelMode, zoomBy]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const box = boxRef.current;
    if (!box?.classList.contains("grabbable")) return;
    box.setPointerCapture(e.pointerId);
    const v = view.current;
    drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y };
    box.classList.add("grabbing");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    commit({ x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) });
  };

  const endDrag = () => {
    drag.current = null;
    boxRef.current?.classList.remove("grabbing");
  };

  // ----------------------------------------------------------------- render

  if (!path) return null;

  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const checker = ALPHA_EXTS.includes(ext);

  return (
    <div
      ref={boxRef}
      className="stage-fill"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onToggleImmersive}
    >
      {busy && <div className="stage-busy" />}
      {error ? (
        <div className="stage-error">
          {s.errors.decode}
          <br />
          {error}
        </div>
      ) : (
        <img
          ref={imgRef}
          className={`stage-img ${checker ? "checker" : ""}`}
          src={fullUrl(path)}
          alt=""
          draggable={false}
          onLoad={applyLoaded}
          onError={() => {
            setBusy(false);
            setError(path);
          }}
          style={{
            width: natural?.w,
            height: natural?.h,
            marginLeft: natural ? -natural.w / 2 : 0,
            marginTop: natural ? -natural.h / 2 : 0,
            visibility: natural ? "visible" : "hidden",
          }}
        />
      )}
    </div>
  );
});
