import { Navigate, createBrowserRouter } from "react-router-dom";
import { AnalysisDetailsPage } from "../../pages/analysis-details/AnalysisDetailsPage";
import { DocumentDetailsPage } from "../../pages/document-details/DocumentDetailsPage";
import { ProjectDetailsPage } from "../../pages/project-details/ProjectDetailsPage";
import { ProjectsListPage } from "../../pages/projects-list/ProjectsListPage";
import { t } from "../../shared/i18n";
import { AppShell } from "../../shared/ui/AppShell";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/projects" replace />,
  },
  {
    path: "/projects",
    element: <ProjectsListPage />,
  },
  {
    path: "/projects/:projectId",
    element: <ProjectDetailsPage />,
  },
  {
    path: "/projects/:projectId/documents/:documentId",
    element: <DocumentDetailsPage />,
  },
  {
    path: "/projects/:projectId/analysis/:jobId",
    element: <AnalysisDetailsPage />,
  },
  {
    path: "*",
    element: (
      <AppShell title={t.router.notFoundTitle} subtitle={t.router.notFoundSubtitle}>
        <section className="panel">
          <p>{t.router.notFoundBody}</p>
        </section>
      </AppShell>
    ),
  },
]);
