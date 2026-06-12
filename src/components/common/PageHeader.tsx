import type { ReactNode } from "react";

type PageHeaderProps = {
  variant?: "standard" | "workspace";
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  backLabel?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  className?: string;
  stickySubnav?: ReactNode;
};

export default function PageHeader({
  variant = "standard",
  title,
  eyebrow,
  subtitle,
  meta,
  backLabel,
  onBack,
  actions,
  className,
  stickySubnav,
}: PageHeaderProps) {
  return (
    <>
      {stickySubnav ? <div className="page-subnav page-subnav-sticky">{stickySubnav}</div> : null}
      <section className={`page-header page-header-${variant} ${className || ""}`.trim()}>
      {backLabel ? (
        <div className="page-header-backRow">
          <button className="btn btn-ghost btn-soft" type="button" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      ) : null}

      <div className="page-header-main">
        <div className="page-header-copy">
          {eyebrow ? <div className="page-header-eyebrow">{eyebrow}</div> : null}
          <div className="page-header-title">{title}</div>
          {subtitle ? <div className="page-header-subtitle">{subtitle}</div> : null}
          {meta ? <div className="page-header-meta">{meta}</div> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
    </section>
    </>
  );
}
