import { humanBytes } from "../lib/format";
import { useStrings } from "../lib/i18n";
import type { Entry } from "../lib/folder";

/** The bottom line: which file, where in the folder, how big, how zoomed. */
export function StatusBar({
  entry,
  index,
  total,
  natural,
  zoom,
}: {
  entry: Entry | null;
  index: number;
  total: number;
  natural: { w: number; h: number } | null;
  zoom: number;
}) {
  const s = useStrings();

  if (!entry) {
    return (
      <div className="status-bar">
        <span className="status-name">{s.status.noFile}</span>
      </div>
    );
  }

  return (
    <div className="status-bar">
      <span className="status-name" title={entry.path}>
        {entry.name}
      </span>
      <span className="sb-item">
        {index + 1} {s.status.of} {total}
      </span>
      {natural && (
        <span className="sb-item">
          {natural.w} × {natural.h}
        </span>
      )}
      <span className="sb-item">{humanBytes(entry.size)}</span>
      <span className="sb-item">{Math.round(zoom * 100)}%</span>
    </div>
  );
}
