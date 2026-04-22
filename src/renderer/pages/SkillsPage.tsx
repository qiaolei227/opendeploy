import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillsStore } from '@renderer/stores/skills-store';
import type { SkillMeta } from '@shared/skill-types';

type FilterKey = 'all' | string;

/** First segment of the skill id — the product/visibility bucket. */
function namespaceOf(skill: SkillMeta): string {
  return skill.id.split('/', 1)[0];
}

/** Map a namespace to its display name via i18n, falling back to the raw id. */
function namespaceDisplayName(ns: string, t: (k: string) => string): string {
  // i18n keys: `skills.erp.common` / `skills.erp.k3cloud` / `skills.erp.<ns>`.
  // Unknown namespaces show the raw segment — better than a missing-key token.
  const key = `skills.erp.${ns}`;
  const resolved = t(key);
  return resolved === key ? ns : resolved;
}

/**
 * SkillsPage — consultant-facing surface.
 *
 * Organization: **by namespace** (first segment of the skill id), which maps
 * 1:1 to the ERP product the skill covers. `system/*` skills are internal
 * (diagnostics / bootstrap) and hidden from this page entirely — they stay
 * loadable by agents via `load_skill` but don't clutter the user view.
 * Category sticks around as a secondary chip on each card for future sub-nav.
 */
export function SkillsPage() {
  const { t } = useTranslation();
  const {
    skills,
    bundleVersion,
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
    void checkUpdates();
  }, [load, checkUpdates]);

  // Hide `system/*` skills from the consultant view. They're still loadable
  // by agents (see skills-integration.ts) but not surfaced to humans.
  const userSkills = useMemo(
    () => skills.filter((s) => namespaceOf(s) !== 'system'),
    [skills]
  );

  // Unique namespace buckets discovered from installed user-visible skills.
  // Order: common first, then alphabetical. Stable chip row across skill
  // install/remove.
  const buckets = useMemo(() => {
    const set = new Set<string>();
    let hasCommon = false;
    for (const s of userSkills) {
      const ns = namespaceOf(s);
      if (ns === 'common') hasCommon = true;
      else set.add(ns);
    }
    const rest = [...set].sort();
    return hasCommon ? ['common', ...rest] : rest;
  }, [userSkills]);

  const counts = useMemo(() => {
    const map = new Map<FilterKey, number>([['all', userSkills.length]]);
    for (const b of buckets) map.set(b, 0);
    for (const s of userSkills) {
      const ns = namespaceOf(s);
      map.set(ns, (map.get(ns) ?? 0) + 1);
    }
    return map;
  }, [userSkills, buckets]);

  const filtered = useMemo(() => {
    if (filter === 'all') return userSkills;
    return userSkills.filter((s) => namespaceOf(s) === filter);
  }, [userSkills, filter]);

  const localVersion = bundleVersion;

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
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('skills.bundleLabel')}</div>
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
                    ·{' '}
                    {t('skills.lastChecked', {
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

        {/* Product filter */}
        {buckets.length > 0 && (
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
            {buckets.map((b) => (
              <FilterChip
                key={b}
                active={filter === b}
                onClick={() => setFilter(b)}
                label={namespaceDisplayName(b, t)}
                count={counts.get(b) ?? 0}
              />
            ))}
          </div>
        )}

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
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    marginBottom: 4
                  }}
                >
                  {s.title ?? s.name}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 8,
                    flexWrap: 'wrap'
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--dim)' }}
                  >
                    {s.id}
                  </span>
                  <span className="chip" style={{ fontSize: 10 }}>
                    v{s.version}
                  </span>
                  <span className="chip accent" style={{ fontSize: 10 }}>
                    {namespaceDisplayName(namespaceOf(s), t)}
                  </span>
                  {s.category && (
                    <span className="chip" style={{ fontSize: 10 }}>
                      {t(`skills.category.${s.category}`)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{s.description}</div>
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
  count
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
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
