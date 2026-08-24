import { memo, useEffect, useRef } from "react";

import { thumbUrl } from "../lib/limg";
import type { Entry } from "../lib/folder";

/**
 * The strip along the bottom.
 *
 * Thumbnails are `loading="lazy"`, so a folder of two thousand pictures only
 * decodes the dozen currently scrolled into view. The active cell is scrolled
 * back into view whenever the selection changes from elsewhere — arrow keys,
 * the grid, a slideshow tick — which is what keeps the strip in sync with the
 * stage instead of stranding the highlight offscreen.
 */
function FilmstripInner({
  entries,
  index,
  onPick,
}: {
  entries: Entry[];
  index: number;
  onPick: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(".thumb.active");
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  if (!entries.length) return null;

  return (
    <div className="filmstrip" ref={ref}>
      {entries.map((e, i) => (
        <button
          key={e.path}
          className={`thumb ${i === index ? "active" : ""}`}
          onClick={() => onPick(i)}
          title={e.name}
          aria-current={i === index}
        >
          <img src={thumbUrl(e.path, 200)} alt="" loading="lazy" draggable={false} />
        </button>
      ))}
    </div>
  );
}

/**
 * Memoised: the stage reports its zoom on every wheel event, and without this
 * a folder of two thousand thumbnails would re-render on each one.
 */
export const Filmstrip = memo(FilmstripInner);
