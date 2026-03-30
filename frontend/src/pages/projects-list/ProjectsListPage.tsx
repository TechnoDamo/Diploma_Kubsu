import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
} from "../../features/projects/projects.queries";
import { readApiErrorMessage } from "../../shared/api/errors";
import { t } from "../../shared/i18n";
import { AppShell } from "../../shared/ui/AppShell";
import type { ProjectId } from "../../shared/types/api";
import { MarkdownContent } from "../../shared/ui/MarkdownContent";

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
    ? readApiErrorMessage(createProjectMutation.error, t.projectsList.errors.create)
    : null;

  const listError = isError
    ? readApiErrorMessage(error, t.projectsList.errors.load)
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
    const confirmed = window.confirm(t.projectsList.confirmDelete);
    if (!confirmed) {
      return;
    }
    deleteProjectMutation.mutate(projectId);
  }

  return (
    <AppShell
      title={t.projectsList.title}
      subtitle={t.projectsList.subtitle}
    >
      <section className="metrics-grid">
        <article className="metric-card">
          <span className="metric-card__label">{t.projectsList.metrics.loadedLabel}</span>
          <strong>{data?.total ?? 0}</strong>
          <p>{t.projectsList.metrics.loadedBody}</p>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">{t.projectsList.metrics.backendModeLabel}</span>
          <strong>{t.projectsList.metrics.backendModeValue}</strong>
          <p>{t.projectsList.metrics.backendModeBody}</p>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">{t.projectsList.metrics.workflowLabel}</span>
          <strong>{t.projectsList.metrics.workflowValue}</strong>
          <p>{t.projectsList.metrics.workflowBody}</p>
        </article>
      </section>

      <section className="page-grid page-grid--sidebar">
        <section className="panel panel--glow">
          <div className="section-head">
            <div>
              <span className="section-kicker">{t.projectsList.create.kicker}</span>
              <h2>{t.projectsList.create.title}</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={handleCreateProject}>
            <label>
              {t.projectsList.create.name}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                placeholder={t.projectsList.create.namePlaceholder}
              />
            </label>
            <label>
              {t.projectsList.create.description}
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                placeholder={t.projectsList.create.descriptionPlaceholder}
              />
            </label>
            <button type="submit" disabled={!canSubmit || createProjectMutation.isPending}>
              {createProjectMutation.isPending
                ? t.projectsList.create.creating
                : t.projectsList.create.submit}
            </button>
          </form>
          {createError && <p className="error">{createError}</p>}
        </section>

        <section className="panel panel--stack">
          <div className="section-head">
            <div>
              <span className="section-kicker">{t.projectsList.list.kicker}</span>
              <h2>{t.projectsList.list.title}</h2>
            </div>
            <span className="pill">{t.projectsList.list.visible(data?.items.length ?? 0)}</span>
          </div>
          {isLoading && <p className="muted">{t.projectsList.list.loading}</p>}
          {listError && <p className="error">{listError}</p>}
          {!isLoading && !isError && data && data.items.length === 0 && (
            <div className="empty-state">
              <h3>{t.projectsList.list.emptyTitle}</h3>
              <p>{t.projectsList.list.emptyBody}</p>
            </div>
          )}
          {!isLoading && !isError && data && data.items.length > 0 && (
            <ul className="entity-list">
              {data.items.map((project) => (
                <li key={project.id} className="entity-card entity-card--project">
                  <div className="entity-card__header">
                    <div>
                      <h3>{project.name}</h3>
                      {project.description ? (
                        <MarkdownContent content={project.description} />
                      ) : (
                        <p>{t.projectsList.list.noDescription}</p>
                      )}
                    </div>
                    <span className="pill">#{project.id}</span>
                  </div>
                  <div className="entity-meta entity-meta-wrap">
                    <span>{t.shared.counts.documents(project.document_count)}</span>
                    <span>{t.shared.updatedAt(project.updated_at)}</span>
                  </div>
                  <div className="inline-actions">
                    <Link to={`/projects/${project.id}`}>{t.projectsList.list.open}</Link>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleDeleteProject(project.id)}
                    >
                      {t.shared.delete}
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
