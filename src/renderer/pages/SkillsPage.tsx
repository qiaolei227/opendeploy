import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillsStore } from '@renderer/stores/skills-store';

/**
 * Bucket used for skills without an `erpProvider` — shown as "通用 / Common".
 * Kept as a string constant rather than `undefined` so the filter chip can
 * still be a React key.
 */
const COMMON_BUCKET = '__common__';

type FilterKey = 'all' | string;

/** Map known erpProvider ids to display names. Unknown ids fall back to the raw string. */
function erpDisplayName(erpProvider: string | undefined, t: (k: string) => string): string {
  if (!erpProvider) return t('skills.erp.common');
  // Look up via i18n so new ERPs can be added without code. Fallback to raw id
  // when the key doesn't exist (i18next returns the key itself on miss).
  const key = `skills.erp.${erpProvider}`;
  const resolved = t(key);
  return resolved === key ? erpProvider : resolved;
}

/**
 * SkillsPage — consultant-facing surface.
 *
 * Organization: **by product (erpProvider)**, not by capability category.
 * Consultants reach for skills based on which ERP they're implementing, so
 * that's the first cut. Category sticks around as a secondary chip on each
 * card for agent-visible hints / future sub-nav.
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

  // Unique erpProvider buckets discovered from installed skills. Order:
  // common first, then alphabetical. Consistent bucket ordering keeps the
  // filter row visually stable as skills are added/removed.
  const buckets = useMemo(() => {
    const set = new Set<string>();
    let hasCommon = false;
    for (const s of skills) {
      if (!s.erpProvider) hasCommon = true;
      else set.add(s.erpProvider);
    }
    const erps = [...set].sort();
    return hasCommon ? [COMMON_BUCKET, ...erps] : erps;
  }, [skills]);

  const counts = useMemo(() => {
    const map = new Map<FilterKey, number>([['all', skills.length]]);
    for (const b of buckets) map.set(b, 0);
    for (const s of skills) {
      const key = s.erpProvider ?? COMMON_BUCKET;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [skills, buckets]);

  const filtered = useMemo(() => {
    if (filter === 'all') return skills;
    if (filter === COMMON_BUCKET) return skills.filter((s) => !s.erpProvider);
    return skills.filter((s) => s.erpProvider === filter);
  }, [skills, filter]);

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
                label={
                  b === COMMON_BUCKET
                    ? t('skills.erp.common')
                    : erpDisplayName(b, t)
                }
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
                  <span className="chip accent" style={{ fontSize: 10 }}>
                    {erpDisplayName(s.erpProvider, t)}
                  </span>
                  {s.category && (
                    <span className="chip" style={{ fontSize: 10 }}>
                      {t(`skills.category.${s.category}`)}
                    </span>
                  )}
                  {s.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="chip"
                      style={{ fontSize: 10, opacity: 0.7 }}
                    >
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
