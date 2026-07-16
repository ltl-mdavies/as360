// src/components/common/PopoverMenu.tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

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
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!open) return;
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      const firstEnabled = itemRefs.current.find((item) => item && !item.disabled);
      firstEnabled?.focus();
    });
  }, [open]);

  function focusMenuItem(nextIndex: number) {
    const enabledItems = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    if (enabledItems.length === 0) return;
    const next = ((nextIndex % enabledItems.length) + enabledItems.length) % enabledItems.length;
    enabledItems[next]?.focus();
  }

  function handleMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const enabledItems = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    const currentIndex = enabledItems.findIndex((item) => item === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusMenuItem(currentIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusMenuItem(currentIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusMenuItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusMenuItem(enabledItems.length - 1);
    }
  }

  return (
    <div ref={rootRef} className="pm-root">
      <button
        ref={buttonRef}
        type="button"
        className={`pm-btn ${buttonLabel ? "pm-btn-label" : ""} ${buttonClassName}`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
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
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((it, index) => (
            <button
              key={it.action}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
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
