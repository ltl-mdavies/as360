import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loadingCard">
          <div className="auth-loadingDot" />
          <div className="auth-loadingText">Securing your workspace…</div>
        </div>
      </div>
    );
  }

  if (isAuthenticated || isShareAccessRoute(location.pathname, location.search)) {
    return <>{children}</>;
  }

  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
}

function isShareAccessRoute(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  return pathname.startsWith("/p/") && Boolean(params.get("share"));
}
