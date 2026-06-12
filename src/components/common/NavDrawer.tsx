// src/components/common/NavDrawer.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

type NavItem = { label: string; path: string; kind?: "primary" | "secondary"; meta?: string };

export default function NavDrawer({
  isOpen,
  onClose,
  items,
  activePath,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: NavItem[];
  activePath?: string;
}) {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  useEffect(() => {
    if (!isOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const userName = user?.displayName || "Workspace User";
  const userMeta = user?.email || "Adspace360";

  return (
    <div className="nav-backdrop" onMouseDown={onClose}>
      <div
        className="nav-drawer"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
		<div className="nav-head">
		  <div className="nav-user">
			<div className="nav-avatar">{userName.charAt(0).toUpperCase()}</div>
			<div className="nav-userText">
			  <div className="nav-userName">{userName}</div>
			  <div className="nav-userMeta">{userMeta}</div>
			</div>
		  </div>
		
		  <button className="iconbtn" type="button" onClick={onClose} aria-label="Close">
			✕
		  </button>
		</div>

        <div className="nav-body">
          {items.map((it) => {
            const isActive = activePath && it.path === activePath;
            return (
              <button
                key={it.path}
                type="button"
                className={[
                  "nav-item",
                  it.kind === "primary" ? "nav-item-primary" : "",
                  isActive ? "is-active" : "",
                ].join(" ")}
                onClick={() => {
                  navigate(it.path);
                  onClose();
                }}
              >
                <div className="nav-item-text">
				  <div className="nav-item-label">{it.label}</div>
				  {it.meta && <div className="nav-item-meta">{it.meta}</div>}
				</div>
              </button>
            );
          })}
        </div>

        <div className="nav-foot">
		  <button
			className="nav-signout"
			type="button"
			onClick={() => {
            signOut();
            onClose();
            navigate("/login");
          }}
		  >
			Sign Out
		  </button>
		</div>
      </div>
    </div>
  );
}
