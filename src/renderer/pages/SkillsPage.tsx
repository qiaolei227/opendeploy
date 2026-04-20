import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillsStore } from '@renderer/stores/skills-store';
import type { KnowledgeSource } from '@shared/skill-types';

/**
 * SkillsPage — list of installed skills, plus a minimal installer form
 * (choose github/gitee/local kind, paste "owner/repo" or a path, hit install).
 *
 * MVP scope: no per-skill update, no multiple configured sources (one form,
 * one shot). Settings persistence lives in AppSettings.knowledgeSources but
 * the UI doesn't surface the list yet — one thing at a time.
 */
export function SkillsPage() {
  const { t } = useTranslation();
  const { skills, loading, busy, error, lastMessage, load, install, removeAll, clearMessage } =
    useSkillsStore();

  const [kind, setKind] = useState<KnowledgeSource['kind']>('github');
  const [location, setLocation] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (): Promise<void> => {
    const loc = location.trim();
    if (!loc) return;
    await install({ id: loc, kind, location: loc });
    setLocation('');
  };

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <h2 className="page-title">{t('nav.skills')}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {t('skills.intro')}
        </p>

        <section style={{ margin: '24px 0 32px' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px' }}>{t('skills.installHeading')}</h3>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap'
            }}
          >
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as KnowledgeSource['kind'])}
              style={{ padding: '6px 10px', fontSize: 13 }}
              disabled={busy}
            >
              <option value="github">GitHub</option>
              <option value="gitee">Gitee</option>
              <option value="local">{t('skills.kindLocal')}</option>
            </select>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={
                kind === 'local'
                  ? t('skills.locationPlaceholderLocal')
                  : t('skills.locationPlaceholderRepo')
              }
              style={{ flex: 1, minWidth: 240, padding: '6px 10px', fontSize: 13 }}
              disabled={busy}
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => void submit()}
              disabled={busy || !location.trim()}
            >
              {t('skills.install')}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t('skills.installHint')}
          </p>
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>
              {error}
              <button
                type="button"
                onClick={clearMessage}
                style={{ marginLeft: 8, fontSize: 11 }}
              >
                ×
              </button>
            </div>
          )}
          {lastMessage === 'installed' && (
            <div className="chip good" style={{ marginTop: 8 }}>
              {t('skills.installed')}
            </div>
          )}
          {lastMessage === 'removed' && (
            <div className="chip" style={{ marginTop: 8 }}>
              {t('skills.removed')}
            </div>
          )}
        </section>

        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12
            }}
          >
            <h3 style={{ fontSize: 15, margin: 0 }}>
              {t('skills.installedHeading', { count: skills.length })}
            </h3>
            {skills.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => void removeAll()}
                disabled={busy}
              >
                {t('skills.removeAll')}
              </button>
            )}
          </div>
          {loading ? (
            <div className="muted">{t('skills.loading')}</div>
          ) : skills.length === 0 ? (
            <div className="card" style={{ padding: 20 }}>
              <div className="muted" style={{ fontSize: 13 }}>
                {t('skills.empty')}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {skills.map((s) => (
                <div key={s.id} className="card" style={{ padding: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 4
                    }}
                  >
                    <span className="mono small">{s.id}</span>
                    <span className="chip" style={{ fontSize: 10 }}>
                      v{s.version}
                    </span>
                    {s.erpProvider && (
                      <span className="chip accent" style={{ fontSize: 10 }}>
                        {s.erpProvider}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13 }}>{s.description}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default SkillsPage;
