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
      title="Mimir Workspace"
      subtitle="Create projects, ingest documents, ask RAG questions, and run contradiction analysis."
    >
      <section className="panel">
        <h2>Create Project</h2>
        <form className="form-grid" onSubmit={handleCreateProject}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              placeholder="Legal Contracts"
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              placeholder="Short description for this workspace."
            />
          </label>
          <button type="submit" disabled={!canSubmit || createProjectMutation.isPending}>
            {createProjectMutation.isPending ? "Creating..." : "Create project"}
          </button>
        </form>
        {createError && <p className="error">{createError}</p>}
      </section>

      <section className="panel">
        <h2>Projects</h2>
        {isLoading && <p className="muted">Loading projects...</p>}
        {listError && <p className="error">{listError}</p>}
        {!isLoading && !isError && data && data.items.length === 0 && (
          <p className="muted">No projects yet.</p>
        )}
        {!isLoading && !isError && data && data.items.length > 0 && (
          <ul className="entity-list">
            {data.items.map((project) => (
              <li key={project.id} className="entity-card">
                <div>
                  <h3>{project.name}</h3>
                  <p>{project.description || "No description provided."}</p>
                </div>
                <div className="entity-meta">
                  <span>{project.document_count} docs</span>
                  <div className="inline-actions">
                    <Link to={`/projects/${project.id}`}>Open</Link>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleDeleteProject(project.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
