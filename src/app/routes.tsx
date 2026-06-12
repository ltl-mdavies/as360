import { Routes, Route, Navigate } from "react-router-dom";
import RequireAuth from "../auth/RequireAuth";
import AngieDashboardPage from "../pages/AngieDashboard/AngieDashboardPage";
import ProjectHubPage from "../pages/ProjectHub/ProjectHubPage";
import ProofApprovalPage from "../pages/ProofApproval/ProofApprovalPage";
import CreativeAssignmentPage from "../pages/CreativeAssignment/CreativeAssignmentPage";
import ArtworkFolderPage from "../pages/ArtworkFolder/ArtworkFolderPage";
import AllocationReportPage from "../pages/AllocationReport/AllocationReportPage";
import AllocationOverridePage from "../pages/AllocationOverride/AllocationOverridePage";
import TransitApprovalPage from "../pages/TransitApproval/TransitApprovalPage";
import DemoLauncherPage from "../pages/Demo/DemoLauncherPage";
import VenueImportPreviewPage from "../pages/VenueBuilder/VenueImportPreviewPage";
import LoginPage from "../pages/Auth/LoginPage";
import SettingsAdminPage from "../pages/Settings/SettingsAdminPage";
import AdminHealthDashboardPage from "../pages/Settings/AdminHealthDashboardPage";
import ProjectDocumentsPage from "../pages/Documents/ProjectDocumentsPage";

export function AppRoutes() {
  return (
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
  );
}
