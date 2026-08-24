import { useEffect, useState } from "react";

import { AssocCard } from "./AssocCard";
import { SkinPicker } from "./SkinPicker";
import { ModeToggle } from "./ModeToggle";
import { LanguagePicker } from "./LanguagePicker";
import { cacheBytes, clearCache } from "../lib/folder";
import { humanBytes } from "../lib/format";
import { hasTauri } from "../lib/tauri";
import { useStrings } from "../lib/i18n";
import type { Prefs } from "../lib/settings";

/** Preferences, plus the file-association block that is the app's headline. */
export function SettingsScreen({
  prefs,
  set,
  onBack,
}: {
  prefs: Prefs;
  set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  onBack: () => void;
}) {
  const s = useStrings();
  const [cache, setCache] = useState<number | null>(null);
  const [freed, setFreed] = useState<string | null>(null);

  // The interval field keeps its own draft string. Bound straight to the number,
  // an empty box parsed as 0 and snapped back to the default, so the 5 could not
  // be deleted — you had to type the new digit first and erase around it.
  const [secDraft, setSecDraft] = useState(String(prefs.slideshowSec));
  useEffect(
    () => setSecDraft(String(prefs.slideshowSec)),
    [prefs.slideshowSec],
  );

  useEffect(() => {
    if (!hasTauri()) return;
    cacheBytes()
      .then(setCache)
      .catch(() => setCache(null));
  }, []);

  return (
    <div className="screen">
      {/* Outside the scrolling body on purpose: the page is long, and having to
          scroll back to the top to leave it is friction you feel every time. */}
      <div className="screen-head">
        <button className="tb-btn" onClick={onBack}>
          <span className="tb-label">← {s.settings.back}</span>
        </button>
        <h1>{s.settings.title}</h1>
      </div>

      <div className="screen-body">
        <div className="screen-inner">
          <AssocCard />

          <div className="card">
            <h2>{s.settings.appearance}</h2>
            <p>{s.settings.appearanceHint}</p>
            <div className="field">
              <span>{s.settings.skin}</span>
              <SkinPicker />
            </div>
            <div className="field">
              <span>{s.settings.mode}</span>
              <ModeToggle />
            </div>
            <div className="field">
              <span>{s.settings.language}</span>
              <LanguagePicker />
            </div>
          </div>

          <div className="card">
            <h2>{s.settings.viewing}</h2>

            <div className="field">
              <span>{s.settings.defaultZoom}</span>
              <select
                value={prefs.zoom}
                onChange={(e) => set("zoom", e.target.value as Prefs["zoom"])}
              >
                <option value="fitLarge">{s.settings.zoomFitLarge}</option>
                <option value="fit">{s.settings.zoomFit}</option>
                <option value="actual">{s.settings.zoomActual}</option>
              </select>
            </div>

            <div className="field">
              <span>{s.settings.wheel}</span>
              <select
                value={prefs.wheel}
                onChange={(e) => set("wheel", e.target.value as Prefs["wheel"])}
              >
                <option value="zoom">{s.settings.wheelZoom}</option>
                <option value="pan">{s.settings.wheelPan}</option>
              </select>
            </div>

            <p style={{ margin: "2px 0 10px", fontSize: 12 }}>
              {s.settings.wheelHint}
            </p>

            <div className="field">
              <span>{s.settings.sort}</span>
              <select
                value={prefs.sort}
                onChange={(e) => set("sort", e.target.value as Prefs["sort"])}
              >
                <option value="name">{s.settings.sortName}</option>
                <option value="date">{s.settings.sortDate}</option>
                <option value="size">{s.settings.sortSize}</option>
              </select>
            </div>

            <div className="field">
              <span>{s.settings.sortDesc}</span>
              <input
                type="checkbox"
                checked={prefs.sortDesc}
                onChange={(e) => set("sortDesc", e.target.checked)}
              />
            </div>

            <div className="field">
              <span>{s.settings.slideshowInterval}</span>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={secDraft}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setSecDraft(raw);
                    // Only commit a value that is actually usable; an empty or
                    // out-of-range box just stays on screen until it isn't.
                    const n = Number(raw);
                    if (
                      raw !== "" &&
                      Number.isFinite(n) &&
                      n >= 1 &&
                      n <= 120
                    ) {
                      set("slideshowSec", n);
                    }
                  }}
                  onBlur={() => setSecDraft(String(prefs.slideshowSec))}
                  style={{ width: 72 }}
                />
                <span style={{ color: "var(--muted)" }}>
                  {s.settings.seconds}
                </span>
              </span>
            </div>

            <div className="field">
              <span>{s.settings.loop}</span>
              <input
                type="checkbox"
                checked={prefs.loop}
                onChange={(e) => set("loop", e.target.checked)}
              />
            </div>

            <div className="field">
              <span>{s.settings.shuffle}</span>
              <input
                type="checkbox"
                checked={prefs.shuffle}
                onChange={(e) => set("shuffle", e.target.checked)}
              />
            </div>
          </div>

          <div className="card">
            <h2>{s.settings.cache}</h2>
            <p>{s.settings.cacheHint}</p>
            <div className="field">
              <span>{cache === null ? "—" : humanBytes(cache)}</span>
              <button
                className="tb-btn"
                disabled={!hasTauri()}
                onClick={async () => {
                  const bytes = await clearCache();
                  setFreed((bytes / 1024 / 1024).toFixed(1));
                  setCache(await cacheBytes());
                }}
              >
                <span className="tb-label">{s.settings.clearCache}</span>
              </button>
            </div>
            {freed && <p style={{ margin: 0 }}>{s.settings.cleared(freed)}</p>}
          </div>

          <div className="card">
            <h2>{s.settings.about}</h2>
            <div className="field">
              <span>{s.settings.version}</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {__APP_VERSION__}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
