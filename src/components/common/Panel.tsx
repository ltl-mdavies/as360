// src/components/common/Panel.tsx
import type { ReactNode } from "react";

type PanelProps = {
  title?: string;
  subtitle?: string;
  right?: ReactNode;        // right side of header (buttons, filters, etc.)
  children: ReactNode;
  className?: string;
};

export default function Panel({ title, subtitle, right, children, className }: PanelProps) {
  return (
    <section className={`panel ${className || ""}`.trim()}>
      {(title || subtitle || right) && (
        <header className="panel-header">
          <div className="panel-header-left">
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <div className="panel-subtitle">{subtitle}</div>}
          </div>
          {right && <div className="panel-header-right">{right}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
