import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useArtifactsStore, type Artifact } from '@renderer/stores/artifacts-store';

/**
 * ArtifactsPanel — right-side rail on the Workspace page listing files the
 * agent wrote during **this** conversation. Defaults to collapsed when there
 * are no artifacts so it stays out of the way until something lands.
 *
 * Intentionally scoped to the session (not the project) so consultants see
 * "what did this chat produce" at a glance. Cross-session browsing of all
 * plugins lives in the Projects page surface (Plan 6+).
 */
export function ArtifactsPanel() {
  const { t } = useTranslation();
  const items = useArtifactsStore((s) => s.items);
  const [collapsed, setCollapsed] = useState(true);
  const [active, setActive] = useState<Artifact | null>(null);

  // Auto-expand on the first artifact; re-collapse when the list empties.
  useEffect(() => {
    if (items.length > 0) setCollapsed(false);
    else setCollapsed(true);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <>
      <aside
        className="artifacts-panel"
        data-collapsed={collapsed ? 'true' : 'false'}
      >
        <button
          type="button"
          className="artifacts-head"
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="artifacts-title">
            {t('artifacts.title')} · {items.length}
          </span>
          <span className="artifacts-chevron">{collapsed ? '▸' : '▾'}</span>
        </button>
        {!collapsed && (
          <div className="artifacts-list">
            {items.map((a) => (
              <button
                key={a.id}
                type="button"
                className="artifact-item"
                onClick={() => setActive(a)}
              >
                <div className="artifact-name">{a.filename}</div>
                <div className="artifact-meta">
                  <span>{t('artifacts.lines', { count: a.lines })}</span>
                  {!a.created && (
                    <span className="chip" style={{ fontSize: 9 }}>
                      {t('artifacts.overwritten')}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>
      {active && <ArtifactDialog artifact={active} onClose={() => setActive(null)} />}
    </>
  );
}

function ArtifactDialog({
  artifact,
  onClose
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await window.opendeploy.pluginsRead(
          artifact.projectId,
          artifact.filename
        );
        if (!cancelled) setContent(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifact.projectId, artifact.filename]);

  const copy = async (): Promise<void> => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className="artifact-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="artifact-dialog">
        <div className="artifact-dialog-head">
          <span className="mono" style={{ fontWeight: 600 }}>
            {artifact.filename}
          </span>
          <span className="muted small" style={{ marginLeft: 8 }}>
            {artifact.path}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => void copy()}>
            {copied ? t('artifacts.copied') : t('artifacts.copy')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('artifacts.close')}
          </button>
        </div>
        <div className="artifact-dialog-body">
          {error ? (
            <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>
          ) : content == null ? (
            <div className="muted">{t('artifacts.loading')}</div>
          ) : (
            <pre className="artifact-code">
              <code>{content}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
