// src/components/common/PopoverMenu.tsx
import { useEffect, useId, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  action: string;
  disabled?: boolean;
  description?: string;
};

export default function PopoverMenu({
  items,
  onAction,
  align = "right",
  ariaLabel = "More actions",
  buttonClassName = "",
  buttonLabel,
}: {
  items: MenuItem[];
  onAction: (action: string) => void;
  align?: "left" | "right";
  ariaLabel?: string;
  buttonClassName?: string;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!open) return;
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="pm-root">
      <button
        className={`pm-btn ${buttonLabel ? "pm-btn-label" : ""} ${buttonClassName}`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation(); // do not trigger row click
          setOpen((v) => !v);
        }}
      >
        {buttonLabel || "⋯"}
        {buttonLabel && <span className="pm-btn-caret" aria-hidden="true">⌄</span>}
      </button>

      {open && (
        <div
          id={menuId}
          className={`pm-menu ${align === "left" ? "pm-left" : "pm-right"}`}
          role="menu"
          onClick={(e) => e.stopPropagation()} // keep clicks inside menu
        >
          {items.map((it) => (
            <button
              key={it.action}
              className="pm-item"
              role="menuitem"
              disabled={!!it.disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onAction(it.action);
              }}
            >
              <span className="pm-itemLabel">{it.label}</span>
              {it.description && <span className="pm-itemDescription">{it.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
