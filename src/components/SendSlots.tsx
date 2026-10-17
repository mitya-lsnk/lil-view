import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { Icon } from "./Icon";
import { splitPath } from "../lib/format";
import { hasTauri } from "../lib/tauri";
import { useStrings } from "../lib/i18n";
import { SEND_SLOTS, type Prefs, type SendSlot } from "../lib/settings";

/**
 * The destinations behind the number keys.
 *
 * All nine rows are always drawn, empty ones included. The digit is the whole
 * point of the feature, and it only reads as fixed if the slot stays visible
 * when nothing is in it — a list that collapses to the filled rows would make
 * the key a photo lands on depend on how many folders came before it.
 */
export function SendSlots({
  prefs,
  set,
}: {
  prefs: Prefs;
  set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
}) {
  const s = useStrings();

  const update = (i: number, next: Partial<SendSlot>) => {
    const slots = prefs.sendSlots.map((slot, n) => (n === i ? { ...slot, ...next } : slot));
    set("sendSlots", slots);
  };

  const pick = async (i: number) => {
    if (!hasTauri()) return;
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    // Leave any name the user typed alone; only fill it in when it's blank, so
    // re-pointing a slot at a different folder doesn't silently rename it.
    const label = prefs.sendSlots[i].label || splitPath(dir).name;
    update(i, { path: dir, label });
  };

  return (
    <div className="card">
      <h2>{s.send.title}</h2>
      <p>{s.send.hint}</p>

      <div className="slots">
        {Array.from({ length: SEND_SLOTS }, (_, i) => {
          const slot = prefs.sendSlots[i];
          const filled = !!slot.path;
          return (
            <div className={`slot ${filled ? "filled" : ""}`} key={i}>
              <span className="slot-key">{i + 1}</span>

              {filled ? (
                <input
                  className="slot-label"
                  value={slot.label}
                  placeholder={s.send.labelPlaceholder}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              ) : (
                <span className="slot-label muted">{s.send.notSet}</span>
              )}

              <span className="slot-path" title={slot.path}>
                {slot.path}
              </span>

              <button
                className="tb-btn"
                onClick={() => void pick(i)}
                disabled={!hasTauri()}
                title={filled ? s.send.change : s.send.pick}
              >
                <Icon name="folder" size={14} />
              </button>

              <button
                className="tb-btn"
                onClick={() => update(i, { path: "", label: "" })}
                disabled={!filled}
                title={s.send.clear}
              >
                <Icon name="remove" size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="field">
        <span>{s.send.advance}</span>
        <input
          type="checkbox"
          checked={prefs.sendAdvances}
          onChange={(e) => set("sendAdvances", e.target.checked)}
        />
      </div>
    </div>
  );
}
