import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectsStore } from '@renderer/stores/projects-store';
import { ProjectForm } from '@renderer/components/ProjectForm';
import type { Project } from '@shared/erp-types';

/**
 * ProjectsPage — CRUD surface for K/3 Cloud projects. Shows the list on load;
 * the form surfaces inline below the list when the user hits "new project" or
 * "edit", so there's no modal scaffolding to get right in MVP.
 */
export function ProjectsPage() {
  const { t } = useTranslation();
  const {
    projects,
    connectionState,
    loading,
    error,
    load,
    create,
    update,
    remove,
    setActive,
    listDatabases,
    clearError
  } = useProjectsStore();

  /** 'list' | 'new' | { mode: 'edit'; id: string } */
  const [view, setView] = useState<'list' | 'new' | { mode: 'edit'; id: string }>('list');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const editing: Project | undefined =
    typeof view === 'object' && view.mode === 'edit'
      ? projects.find((p) => p.id === view.id)
      : undefined;

  const onSubmit = async (input: {
    name: string;
    erpProvider: Project['erpProvider'];
    connection: Project['connection'];
  }) => {
    setSubmitting(true);
    try {
      if (view === 'new') {
        await create({
          name: input.name,
          erpProvider: input.erpProvider,
          connection: input.connection
        });
      } else if (editing) {
        await update(editing.id, { name: input.name, connection: input.connection });
      }
      setView('list');
    } finally {
      setSubmitting(false);
    }
  };

  const removeWithConfirm = async (id: string): Promise<void> => {
    if (!window.confirm(t('projects.deleteConfirm'))) return;
    await remove(id);
  };

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className="page-title">{t('nav.projects')}</h2>
          {view === 'list' && (
            <button type="button" className="btn primary" onClick={() => setView('new')}>
              {t('projects.new')}
            </button>
          )}
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {t('projects.intro')}
        </p>

        {error && (
          <div
            style={{
              color: 'var(--danger)',
              fontSize: 12,
              padding: 12,
              display: 'flex',
              gap: 8,
              alignItems: 'center'
            }}
          >
            <span>{error}</span>
            <button type="button" onClick={clearError} style={{ fontSize: 11 }}>
              ×
            </button>
          </div>
        )}

        {view === 'list' && (
          <section style={{ marginTop: 16 }}>
            {loading ? (
              <div className="muted">{t('projects.loading')}</div>
            ) : projects.length === 0 ? (
              <div className="card" style={{ padding: 20 }}>
                <div className="muted" style={{ fontSize: 13 }}>
                  {t('projects.empty')}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {projects.map((p) => {
                  const isActive = connectionState.projectId === p.id;
                  const statusLabel = isActive
                    ? t(`projects.status.${connectionState.status}`)
                    : '';
                  return (
                    <div key={p.id} className="card" style={{ padding: 14 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4
                        }}
                      >
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                        {isActive && (
                          <span
                            className={`chip ${
                              connectionState.status === 'connected'
                                ? 'good'
                                : connectionState.status === 'error'
                                  ? ''
                                  : 'accent'
                            }`}
                            style={{
                              fontSize: 10,
                              color:
                                connectionState.status === 'error' ? 'var(--danger)' : undefined
                            }}
                          >
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginBottom: 8,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--muted)'
                        }}
                      >
                        <span>
                          {p.connection.server}:{p.connection.port ?? 1433}/{p.connection.database}
                        </span>
                        <span className="chip" style={{ fontSize: 10 }}>
                          {t(`projects.products.${p.erpProvider}`)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!isActive ? (
                          <button
                            type="button"
                            className="btn primary"
                            onClick={() => void setActive(p.id)}
                          >
                            {t('projects.setActive')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void setActive(null)}
                          >
                            {t('projects.deactivate')}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setView({ mode: 'edit', id: p.id })}
                        >
                          {t('projects.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void removeWithConfirm(p.id)}
                          style={{ color: 'var(--danger)' }}
                        >
                          {t('projects.delete')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {(view === 'new' || (typeof view === 'object' && view.mode === 'edit')) && (
          <section className="card" style={{ padding: 20, marginTop: 16 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 16px' }}>
              {view === 'new' ? t('projects.newHeading') : t('projects.editHeading')}
            </h3>
            <ProjectForm
              initial={editing}
              onCancel={() => setView('list')}
              onSubmit={onSubmit}
              onListDatabases={listDatabases}
              submitting={submitting}
            />
          </section>
        )}
      </div>
    </div>
  );
}

export default ProjectsPage;
