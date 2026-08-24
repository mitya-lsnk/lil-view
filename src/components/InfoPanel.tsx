import { useEffect, useState } from "react";

import { imageInfo, type ImageInfo } from "../lib/folder";
import { flattenProps, humanBytes, readShot, splitPath } from "../lib/format";
import { useStrings } from "../lib/i18n";

/**
 * Shot data drawer.
 *
 * The promoted rows (camera, ISO, shutter…) are a fixed shortlist; everything
 * ImageIO returned is still reachable under "all fields", because the tag that
 * matters for a given photo is not always one we thought to name.
 */
export function InfoPanel({ path }: { path: string }) {
  const s = useStrings();
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setErr(null);
    imageInfo(path)
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setErr(String(e)));
    // Guarded so a fast page-through doesn't paint stale metadata over the
    // photo that's now on screen.
    return () => {
      alive = false;
    };
  }, [path]);

  const { name, dir } = splitPath(path);
  const shot = info ? readShot(info.props) : null;
  const rows: [string, string | null][] = shot
    ? [
        [s.info.make, shot.make],
        [s.info.model, shot.model],
        [s.info.lens, shot.lens],
        [s.info.iso, shot.iso === null ? null : String(shot.iso)],
        [s.info.exposure, shot.exposure],
        [s.info.aperture, shot.aperture],
        [s.info.focal, shot.focal],
        [s.info.taken, shot.taken],
        [s.info.gps, shot.gps],
      ]
    : [];
  const known = rows.filter(([, v]) => v);

  return (
    <aside className="info-panel">
      <h2>{s.info.title}</h2>

      <section className="info-sec">
        <h3>{s.info.file}</h3>
        <dl>
          <div className="info-row">
            <dt>{s.info.name}</dt>
            <dd>{name}</dd>
          </div>
          <div className="info-row">
            <dt>{s.info.path}</dt>
            <dd>{dir}</dd>
          </div>
          {info && (
            <div className="info-row">
              <dt>{s.info.size}</dt>
              <dd>{humanBytes(info.bytes)}</dd>
            </div>
          )}
          {info?.width && info?.height && (
            <div className="info-row">
              <dt>{s.info.dimensions}</dt>
              <dd>
                {info.width} × {info.height}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {known.length > 0 && (
        <section className="info-sec">
          <h3>{s.info.camera}</h3>
          <dl>
            {known.map(([k, v]) => (
              <div className="info-row" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {info && known.length === 0 && !err && (
        <section className="info-sec">
          <p style={{ fontSize: 12, opacity: 0.7 }}>{s.info.none}</p>
        </section>
      )}

      {err && <div className="stage-error">{err}</div>}

      {info && (
        <section className="info-sec">
          <h3>
            <button
              onClick={() => setShowAll((v) => !v)}
              style={{
                font: "inherit",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "inherit",
                textTransform: "inherit",
                letterSpacing: "inherit",
              }}
            >
              {showAll ? "▾" : "▸"} {s.info.raw}
            </button>
          </h3>
          {showAll && (
            <dl>
              {flattenProps(info.props).map(([k, v]) => (
                <div className="info-row" key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
    </aside>
  );
}
