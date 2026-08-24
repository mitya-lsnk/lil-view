import { memo, useEffect, useRef } from "react";

import { thumbUrl } from "../lib/limg";
import type { Entry } from "../lib/folder";

/**
 * Contact-sheet view of the whole folder.
 *
 * Deliberately plain CSS grid with `loading="lazy"` images rather than a
 * virtualised list: the browser already skips decoding offscreen thumbnails,
 * and a few thousand empty `<button>` elements cost far less than the bookkeeping
 * a windowing library would add. If a folder ever gets big enough for the DOM
 * itself to hurt, that's the point to reconsider — not before.
 */
function GridViewInner({
  entries,
  index,
  cell,
  onPick,
}: {
  entries: Entry[];
  index: number;
  /** Cell size in px, from the zoom controls. */
  cell: number;
  /** Single click selects; the parent decides whether to leave the grid. */
  onPick: (i: number, open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(".cell.active")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div className="grid-view" ref={ref}>
      <div className="grid-inner" style={{ ["--cell" as string]: `${cell}px` }}>
        {entries.map((e, i) => (
          <button
            key={e.path}
            className={`cell ${i === index ? "active" : ""}`}
            onClick={() => onPick(i, false)}
            onDoubleClick={() => onPick(i, true)}
            title={e.name}
          >
            <img src={thumbUrl(e.path, Math.max(200, cell * 2))} alt="" loading="lazy" draggable={false} />
            <span className="cell-name">{e.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Memoised for the same reason as the filmstrip — see there. */
export const GridView = memo(GridViewInner);
