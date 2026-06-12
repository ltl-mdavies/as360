type AdminSubnavProps = {
  active: "projects" | "settings" | "health";
  onProjects: () => void;
  onSettings: () => void;
  onHealth: () => void;
};

export default function AdminSubnav({
  active,
  onProjects,
  onSettings,
  onHealth,
}: AdminSubnavProps) {
  return (
    <div className="page-subnav-main settings-subnav">
      <button
        className={`btn btn-ghost btn-soft settings-subnavBtn ${active === "projects" ? "is-active" : ""}`.trim()}
        type="button"
        onClick={onProjects}
      >
        Projects
      </button>
      <button
        className={`btn btn-ghost btn-soft settings-subnavBtn ${active === "settings" ? "is-active" : ""}`.trim()}
        type="button"
        onClick={onSettings}
      >
        Admin Setup
      </button>
      <button
        className={`btn btn-ghost btn-soft settings-subnavBtn ${active === "health" ? "is-active" : ""}`.trim()}
        type="button"
        onClick={onHealth}
      >
        Health Dashboard
      </button>
    </div>
  );
}
