import { useSkin } from "../lib/skin";
import { useStrings } from "../lib/i18n";

/** Sun/moon switch for the header — flips the light/dark axis. */
export function ModeToggle() {
  const { mode, toggleMode } = useSkin();
  const s = useStrings();
  const dark = mode === "dark";
  return (
    <button
      className="mode-toggle"
      onClick={toggleMode}
      title={dark ? s.mode.toLightTitle : s.mode.toDarkTitle}
      aria-label={dark ? s.mode.toLightAria : s.mode.toDarkAria}
      aria-pressed={dark}
    >
      {dark ? "☾" : "☀"}
    </button>
  );
}
