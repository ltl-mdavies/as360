// src/pages/Demo/DemoLauncherPage.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import { demoStore, useDemoStore } from "../../domain/store/demoStore";

export default function DemoLauncherPage() {
  const navigate = useNavigate();
  const projectId = useDemoStore((s) => s.activeProjectId);
  const project = useDemoStore((s) => s.projects.find((p) => p.id === s.activeProjectId));

  useEffect(() => {
    demoStore.actions.hydrateDemo();
  }, []);

  return (
    <AppShell pageClassName="workspace" customerName="Demo">
      <div style={{ padding: 14 }}>
        <Panel>
          <div style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Demo Mode</div>
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
              Launch a fully seeded demo project. Reset anytime.
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn btn-primary btn-wide"
                type="button"
                onClick={() => navigate(`/p/${projectId}?mode=customer`, { state: { demo: true } })}
              >
                Open Demo Hub
              </button>

              <button
                className="btn btn-ghost btn-soft btn-wide"
                type="button"
                onClick={() => demoStore.actions.resetDemo()}
              >
                Reset Demo
              </button>
            </div>

            {project && (
              <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
                Current demo project: <strong style={{ color: "var(--text)" }}>{project.title}</strong>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}