import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import RequireAuth from "../auth/RequireAuth";

const AngieDashboardPage = lazy(() => import("../pages/AngieDashboard/AngieDashboardPage"));
const ProjectHubPage = lazy(() => import("../pages/ProjectHub/ProjectHubPage"));
const ProofApprovalPage = lazy(() => import("../pages/ProofApproval/ProofApprovalPage"));
const CreativeAssignmentPage = lazy(() => import("../pages/CreativeAssignment/CreativeAssignmentPage"));
const ArtworkFolderPage = lazy(() => import("../pages/ArtworkFolder/ArtworkFolderPage"));
const AllocationReportPage = lazy(() => import("../pages/AllocationReport/AllocationReportPage"));
const AllocationOverridePage = lazy(() => import("../pages/AllocationOverride/AllocationOverridePage"));
const TransitApprovalPage = lazy(() => import("../pages/TransitApproval/TransitApprovalPage"));
const DemoLauncherPage = lazy(() => import("../pages/Demo/DemoLauncherPage"));
const VenueImportPreviewPage = lazy(() => import("../pages/VenueBuilder/VenueImportPreviewPage"));
const LoginPage = lazy(() => import("../pages/Auth/LoginPage"));
const SettingsAdminPage = lazy(() => import("../pages/Settings/SettingsAdminPage"));
const AdminHealthDashboardPage = lazy(() => import("../pages/Settings/AdminHealthDashboardPage"));
const ProjectDocumentsPage = lazy(() => import("../pages/Documents/ProjectDocumentsPage"));

function RouteFallback() {
  return (
    <div className="auth-loading">
      <div className="auth-loadingCard">
        <div className="auth-loadingDot" />
        <div className="auth-loadingText">Loading workspace...</div>
      </div>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/customer/projects" />} />
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/customer/projects"
          element={
            <RequireAuth>
              <AngieDashboardPage />
            </RequireAuth>
          }
        />

        <Route
          path="/p/:projectId"
          element={
            <RequireAuth>
              <ProjectHubPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId/artwork"
          element={
            <RequireAuth>
              <ArtworkFolderPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId/assignment"
          element={
            <RequireAuth>
              <CreativeAssignmentPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId/proofs"
          element={
            <RequireAuth>
              <ProofApprovalPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId/docs"
          element={
            <RequireAuth>
              <ProjectDocumentsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId/allocation-report"
          element={
            <RequireAuth>
              <AllocationReportPage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId/allocation-override"
          element={
            <RequireAuth>
              <AllocationOverridePage />
            </RequireAuth>
          }
        />
        <Route
          path="/p/:projectId/transit"
          element={
            <RequireAuth>
              <TransitApprovalPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/venues"
          element={
            <RequireAuth>
              <VenueImportPreviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <RequireAuth>
              <SettingsAdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/health"
          element={
            <RequireAuth>
              <AdminHealthDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/demo"
          element={
            <RequireAuth>
              <DemoLauncherPage />
            </RequireAuth>
          }
        />
      </Routes>
    </Suspense>
  );
}
