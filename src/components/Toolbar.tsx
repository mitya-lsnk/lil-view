import { Icon } from "./Icon";
import { ModeToggle } from "./ModeToggle";
import { LanguagePicker } from "./LanguagePicker";
import { useStrings } from "../lib/i18n";

/**
 * The top bar: opening, paging, and the view toggles.
 *
 * Zoom and rotation are deliberately *not* here — they moved onto the picture
 * itself (StageControls), and the skin picker moved into Settings. The bar had
 * grown past the width of a narrow window and was competing with the photo for
 * attention.
 */

interface Props {
  hasImage: boolean;
  canPrev: boolean;
  canNext: boolean;
  filmstrip: boolean;
  grid: boolean;
  info: boolean;
  slideshow: boolean;
  title: string;
  onOpen: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFilmstrip: () => void;
  onToggleGrid: () => void;
  onToggleInfo: () => void;
  onToggleSlideshow: () => void;
  onFullscreen: () => void;
  onMore: (x: number, y: number) => void;
  /** Is the sibling editor actually installed? */
  suiteReady: boolean;
  onSendToSuite: () => void;
  onSettings: () => void;
}

export function Toolbar(p: Props) {
  const s = useStrings();

  return (
    <div className="toolbar" data-tauri-drag-region>
      <button className="tb-btn" onClick={p.onOpen} title={s.toolbar.open}>
        <span className="tb-label">{s.app.openBtn}</span>
      </button>

      <span className="tb-sep" />

      <button className="tb-btn" onClick={p.onPrev} disabled={!p.canPrev} title={s.toolbar.prev}>
        <Icon name="prev" />
      </button>
      <button className="tb-btn" onClick={p.onNext} disabled={!p.canNext} title={s.toolbar.next}>
        <Icon name="next" />
      </button>

      <span className="tb-title">{p.title}</span>

      <button
        className={`tb-btn ${p.filmstrip ? "on" : ""}`}
        onClick={p.onToggleFilmstrip}
        title={s.toolbar.filmstrip}
      >
        <Icon name="filmstrip" />
      </button>
      <button className={`tb-btn ${p.grid ? "on" : ""}`} onClick={p.onToggleGrid} title={s.toolbar.grid}>
        <Icon name="grid" />
      </button>
      <button
        className={`tb-btn ${p.slideshow ? "on" : ""}`}
        onClick={p.onToggleSlideshow}
        disabled={!p.hasImage}
        title={s.toolbar.slideshow}
      >
        <Icon name="slideshow" />
      </button>
      <button
        className={`tb-btn ${p.info ? "on" : ""}`}
        onClick={p.onToggleInfo}
        disabled={!p.hasImage}
        title={s.toolbar.info}
      >
        <Icon name="info" />
      </button>
      <button className="tb-btn" onClick={p.onFullscreen} disabled={!p.hasImage} title={s.toolbar.fullscreen}>
        <Icon name="fullscreen" />
      </button>
      <button
        className="tb-btn"
        disabled={!p.hasImage}
        title={s.toolbar.more}
        onClick={(e) => {
          // Anchor the menu to the button so it drops straight down from it.
          const r = e.currentTarget.getBoundingClientRect();
          p.onMore(r.left, r.bottom + 4);
        }}
      >
        <Icon name="more" />
      </button>

      {/* Always shown, installed or not. When it isn't, the button is drawn
          dashed and muted and says so on click — hiding it entirely means
          nobody ever learns the hand-off exists. */}
      <button
        className={`tb-btn ${p.suiteReady ? "" : "hint"}`}
        onClick={p.onSendToSuite}
        disabled={!p.hasImage}
        title={p.suiteReady ? s.toolbar.sendToImage : s.toolbar.sendToImageMissing}
      >
        <Icon name="edit" />
      </button>

      <span className="tb-sep" />

      <ModeToggle />
      <LanguagePicker />
      <button className="tb-btn" onClick={p.onSettings} title={s.toolbar.settings}>
        <Icon name="settings" />
      </button>
    </div>
  );
}
