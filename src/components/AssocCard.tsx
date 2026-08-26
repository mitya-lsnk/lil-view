import { useCallback, useEffect, useState } from "react";

import { assocStatus, restoreHandlers, setDefaultHandler, type AssocReport } from "../lib/folder";
import { hasTauri } from "../lib/tauri";
import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * "Open every image in lil view."
 *
 * The report shown here is read back from LaunchServices *after* the write, not
 * inferred from return codes, so a type macOS refused to hand over shows up as a
 * red row naming whoever still owns it. A green "22 of 22" therefore means the
 * system agrees, which is the only version of this claim worth making.
 */
export function AssocCard() {
  const s = useStrings();
  const [report, setReport] = useState<AssocReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasTauri()) return;
    try {
      setReport(await assocStatus());
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<AssocReport>) => {
    setBusy(true);
    setErr(null);
    try {
      setReport(await fn());
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const full = report ? report.ok === report.total && report.total > 0 : false;

  return (
    <div className="card">
      <h2>{s.assoc.title}</h2>
      <p>{s.assoc.hint}</p>

      {report && (
        <div className="assoc-head">
          <span className={`assoc-score ${full ? "full" : "partial"}`}>
            {s.assoc.score(report.ok, report.total)}
          </span>
        </div>
      )}

      {report?.blocked && <div className="assoc-note">{s.assoc.unbundled}</div>}
      {report && !report.blocked && !report.installed && (
        <div className="assoc-note">
          {s.assoc.notInstalled}
          {report.bundlePath && (
            <>
              <br />
              <code style={{ fontSize: 11, opacity: 0.8 }}>{report.bundlePath}</code>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="tb-btn" onClick={() => run(setDefaultHandler)} disabled={busy || !hasTauri()}>
          <span className="tb-label">{busy ? s.assoc.applying : s.assoc.apply}</span>
        </button>
        <button className="tb-btn" onClick={() => run(restoreHandlers)} disabled={busy || !hasTauri()}>
          <span className="tb-label">{s.assoc.restore}</span>
        </button>
        <button className="tb-btn" onClick={() => void load()} disabled={busy || !hasTauri()}>
          <span className="tb-label">{s.assoc.refresh}</span>
        </button>
      </div>

      {err && <div className="stage-error" style={{ marginTop: 10 }}>{err}</div>}

      {report && (
        <div className="assoc-list">
          {report.items.map((it) => (
            <div className={`assoc-item ${it.ok ? "ok" : "no"}`} key={it.uti}>
              <span className="mark">
                <Icon name={it.ok ? "ok" : "close"} size={13} />
              </span>
              <span className="exts">{it.exts.join(", ")}</span>
              <span className="who" title={it.handler ?? undefined}>
                {it.ok ? s.assoc.weAre : (it.handler ?? s.assoc.unknownHandler)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
