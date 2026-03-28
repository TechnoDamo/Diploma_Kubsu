import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
} from "../../features/projects/projects.queries";
import { readApiErrorMessage } from "../../shared/api/errors";
import { AppShell } from "../../shared/ui/AppShell";
import type { ProjectId } from "../../shared/types/api";

export function ProjectsListPage() {
  const [page] = useState(1);
  const [limit] = useState(20);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data, isLoading, isError, error } = useProjects(page, limit);
  const createProjectMutation = useCreateProject();
  const deleteProjectMutation = useDeleteProject();

  const canSubmit = useMemo(() => name.trim().length > 0, [name]);

  const createError = createProjectMutation.isError
    ? readApiErrorMessage(createProjectMutation.error, "Failed to create project.")
    : null;

  const listError = isError
    ? readApiErrorMessage(error, "Failed to load projects.")
    : null;

  function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    createProjectMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
        },
      },
    );
  }

  function handleDeleteProject(projectId: ProjectId) {
    const confirmed = window.confirm(
      "Delete this project? All documents and related analysis jobs will be removed.",
    );
    if (!confirmed) {
      return;
    }
    deleteProjectMutation.mutate(projectId);
  }

  return (
    <AppShell
      title="Mission Control"
      subtitle="Create research workspaces, ingest source material, and run retrieval and contradiction workflows against the live backend."
    >
      <section className="metrics-grid">
        <article className="metric-card">
          <span className="metric-card__label">Projects loaded</span>
          <strong>{data?.total ?? 0}</strong>
          <p>Workspaces available for ingestion and retrieval.</p>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">Backend mode</span>
          <strong>Live API</strong>
          <p>No mock data is used unless explicitly enabled through env.</p>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">Workflow</span>
          <strong>Upload → Index → Query</strong>
          <p>Use a project as the operating envelope for documents and analysis jobs.</p>
        </article>
      </section>

      <section className="page-grid page-grid--sidebar">
        <section className="panel panel--glow">
          <div className="section-head">
            <div>
              <span className="section-kicker">Create</span>
              <h2>New Project</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={handleCreateProject}>
            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                placeholder="Corporate Governance Review"
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                placeholder="What this workspace is for, what domain it covers, and what the retrieval assistant should keep in mind."
              />
            </label>
            <button type="submit" disabled={!canSubmit || createProjectMutation.isPending}>
              {createProjectMutation.isPending ? "Creating project..." : "Create project"}
            </button>
          </form>
          {createError && <p className="error">{createError}</p>}
        </section>

        <section className="panel panel--stack">
          <div className="section-head">
            <div>
              <span className="section-kicker">Active workspaces</span>
              <h2>Projects</h2>
            </div>
            <span className="pill">{data?.items.length ?? 0} visible</span>
          </div>
          {isLoading && <p className="muted">Loading projects...</p>}
          {listError && <p className="error">{listError}</p>}
          {!isLoading && !isError && data && data.items.length === 0 && (
            <div className="empty-state">
              <h3>No projects yet</h3>
              <p>Create the first workspace to start uploading documents and running RAG.</p>
            </div>
          )}
          {!isLoading && !isError && data && data.items.length > 0 && (
            <ul className="entity-list">
              {data.items.map((project) => (
                <li key={project.id} className="entity-card entity-card--project">
                  <div className="entity-card__header">
                    <div>
                      <h3>{project.name}</h3>
                      <p>{project.description || "No description provided."}</p>
                    </div>
                    <span className="pill">#{project.id}</span>
                  </div>
                  <div className="entity-meta entity-meta-wrap">
                    <span>{project.document_count} documents</span>
                    <span>Updated {new Date(project.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="inline-actions">
                    <Link to={`/projects/${project.id}`}>Open workspace</Link>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleDeleteProject(project.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </AppShell>
  );
}
