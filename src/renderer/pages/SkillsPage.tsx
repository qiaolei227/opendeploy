import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillsStore } from '@renderer/stores/skills-store';
import type { SkillCategory } from '@shared/skill-types';

const CATEGORY_ORDER: SkillCategory[] = [
  'workflow',
  'plugin-dev',
  'sales',
  'purchase',
  'inventory',
  'finance',
  'basedata',
  'metadata',
  'debugging'
];

type FilterKey = 'all' | SkillCategory;

/**
 * SkillsPage — consultant-facing surface. One big "检查更新 / 更新" button,
 * one row of category filters, then the installed skills.
 *
 * The repo URL is hidden: checkUpdates / installUpdate always hit the
 * DEFAULT_KNOWLEDGE_SOURCES (GitHub → Gitee fallback) wired in
 * src/main/skills/defaults.ts. Advanced single-source install lives behind
 * `store.installFrom()` — not surfaced here yet, will move to Settings when
 * the enterprise edition needs private repos.
 */
export function SkillsPage() {
  const { t } = useTranslation();
  const {
    skills,
    loading,
    error,
    updateStatus,
    remoteVersion,
    lastCheckedAt,
    load,
    checkUpdates,
    installUpdate,
    removeAll,
    clearError
  } = useSkillsStore();

  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    void load();
    // Fire a silent update check once on first visit. Failures are shown in
    // the hero area but don't block rendering.
    void checkUpdates();
  }, [load, checkUpdates]);

  const filtered = useMemo(() => {
    if (filter === 'all') return skills;
    return skills.filter((s) => s.category === filter);
  }, [skills, filter]);

  const counts = useMemo(() => {
    const map = new Map<FilterKey, number>([['all', skills.length]]);
    for (const cat of CATEGORY_ORDER) map.set(cat, 0);
    for (const s of skills) {
      if (s.category) map.set(s.category, (map.get(s.category) ?? 0) + 1);
    }
    return map;
  }, [skills]);

  const localVersion = skills[0]?.version ?? null;

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <h2 className="page-title">{t('nav.skills')}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {t('skills.intro')}
        </p>

        {/* Hero: version + update control */}
        <section className="card" style={{ padding: 20, margin: '20px 0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {t('skills.bundleLabel')}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 4,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--muted)'
                }}
              >
                <span>
                  {t('skills.localVersion')}: {localVersion ?? '—'}
                </span>
                {remoteVersion && (
                  <span>
                    · {t('skills.remoteVersion')}: {remoteVersion}
                  </span>
                )}
                {lastCheckedAt && (
                  <span>
                    · {t('skills.lastChecked', {
                      time: new Date(lastCheckedAt).toLocaleTimeString()
                    })}
                  </span>
                )}
              </div>
            </div>
            <UpdateAction
              status={updateStatus}
              onCheck={() => void checkUpdates()}
              onInstall={() => void installUpdate()}
            />
          </div>
          {updateStatus === 'up-to-date' && (
            <div className="chip good" style={{ marginTop: 12 }}>
              {t('skills.upToDate')}
            </div>
          )}
          {error && (
            <div
              style={{
                color: 'var(--danger)',
                fontSize: 12,
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <span>{error}</span>
              <button type="button" onClick={clearError} style={{ fontSize: 11 }}>
                ×
              </button>
            </div>
          )}
        </section>

        {/* Category filter */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 16
          }}
        >
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label={t('skills.filterAll')}
            count={counts.get('all') ?? 0}
          />
          {CATEGORY_ORDER.map((cat) => (
            <FilterChip
              key={cat}
              active={filter === cat}
              onClick={() => setFilter(cat)}
              label={t(`skills.category.${cat}`)}
              count={counts.get(cat) ?? 0}
              hidden={(counts.get(cat) ?? 0) === 0}
            />
          ))}
        </div>

        {/* Skill list */}
        {loading ? (
          <div className="muted">{t('skills.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ padding: 20 }}>
            <div className="muted" style={{ fontSize: 13 }}>
              {skills.length === 0 ? t('skills.empty') : t('skills.emptyForFilter')}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map((s) => (
              <div key={s.id} className="card" style={{ padding: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                    flexWrap: 'wrap'
                  }}
                >
                  <span className="mono small">{s.id}</span>
                  <span className="chip" style={{ fontSize: 10 }}>
                    v{s.version}
                  </span>
                  {s.category && (
                    <span className="chip accent" style={{ fontSize: 10 }}>
                      {t(`skills.category.${s.category}`)}
                    </span>
                  )}
                  {s.erpProvider && (
                    <span className="chip" style={{ fontSize: 10 }}>
                      {s.erpProvider}
                    </span>
                  )}
                  {s.tags?.map((tag) => (
                    <span key={tag} className="chip" style={{ fontSize: 10, opacity: 0.7 }}>
                      #{tag}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 13 }}>{s.description}</div>
              </div>
            ))}
          </div>
        )}

        {/* Footer: destructive action tucked below */}
        {skills.length > 0 && (
          <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn"
              onClick={() => void removeAll()}
              style={{ color: 'var(--muted)', fontSize: 12 }}
            >
              {t('skills.removeAll')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function UpdateAction({
  status,
  onCheck,
  onInstall
}: {
  status: ReturnType<typeof useSkillsStore.getState>['updateStatus'];
  onCheck: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation();

  if (status === 'checking') {
    return (
      <button type="button" className="btn" disabled>
        {t('skills.checking')}
      </button>
    );
  }
  if (status === 'installing') {
    return (
      <button type="button" className="btn primary" disabled>
        {t('skills.installing')}
      </button>
    );
  }
  if (status === 'available') {
    return (
      <button type="button" className="btn primary" onClick={onInstall}>
        {t('skills.updateNow')}
      </button>
    );
  }
  return (
    <button type="button" className="btn" onClick={onCheck}>
      {t('skills.checkUpdates')}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  hidden
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'chip accent' : 'chip'}
      style={{
        fontSize: 12,
        padding: '4px 10px',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400
      }}
    >
      {label} · {count}
    </button>
  );
}

export default SkillsPage;
