import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useStrings } from "../lib/i18n";

export interface Action {
  label: string;
  run: () => void;
  danger?: boolean;
  hint?: string;
}

/**
 * The file-actions menu.
 *
 * Rendered through a portal to `document.body` on purpose: the toolbar sits
 * inside `.app-shell`, whose skins apply transforms and animations, and in
 * WKWebView a transformed ancestor becomes the containing block for
 * `position: fixed` — a menu nested inside it would be offset by however far
 * the shell had moved.
 */
export function ActionsMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: Action[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useStrings();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Deferred to the next frame so the click that opened the menu doesn't
    // immediately close it again.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={s.toolbar.more}
      style={{
        position: "fixed",
        // Keep the menu on screen when it's opened near the right or bottom edge.
        left: Math.min(x, window.innerWidth - 250),
        top: Math.min(y, window.innerHeight - actions.length * 34 - 16),
        zIndex: 40,
        minWidth: 230,
        padding: 5,
        background: "var(--surface)",
        color: "var(--ink)",
        border: "var(--bd-w) solid var(--line)",
        borderRadius: "var(--radius-sm)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          role="menuitem"
          onClick={() => {
            onClose();
            a.run();
          }}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            width: "100%",
            padding: "7px 9px",
            font: "inherit",
            fontSize: 13,
            textAlign: "left",
            color: a.danger ? "var(--danger)" : "inherit",
            background: "none",
            border: "none",
            borderRadius: "calc(var(--radius-sm) - 2px)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          <span>{a.label}</span>
          {a.hint && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              {a.hint}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
