import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Zoom and rotation, floated over the bottom-right of the picture.
 *
 * These were in the toolbar and made it too busy — and they are controls you
 * reach for *while* looking at the image, not before. Kept dim until the
 * pointer comes near, so they read as an overlay on the photo rather than as
 * another band of interface.
 *
 * Colours are fixed rather than skin tokens: this sits on top of an arbitrary
 * photograph, so it needs its own contrast, not the surrounding chrome's.
 */
export function StageControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onToggleZoom,
  onRotate,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleZoom: () => void;
  onRotate: (dir: -1 | 1) => void;
}) {
  const s = useStrings();
  return (
    <div className="stage-ctl">
      <button className="sc-btn" onClick={() => onRotate(-1)} title={s.toolbar.rotateLeft}>
        <Icon name="rotateLeft" size={15} />
      </button>
      <button className="sc-btn" onClick={() => onRotate(1)} title={s.toolbar.rotateRight}>
        <Icon name="rotateRight" size={15} />
      </button>
      <span className="sc-sep" />
      <button className="sc-btn" onClick={onZoomOut} title={s.toolbar.zoomOut}>
        <Icon name="minus" size={15} />
      </button>
      <button
        className="sc-btn sc-zoom"
        onClick={onToggleZoom}
        title={`${s.toolbar.fit} / ${s.toolbar.actual}`}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className="sc-btn" onClick={onZoomIn} title={s.toolbar.zoomIn}>
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}
