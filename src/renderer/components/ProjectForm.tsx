import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BosRpcCredentials, ErpProvider, Project } from '@shared/erp-types';

interface DataCenter {
  id: string;
  number: string;
  name: string;
}

/**
 * Products the user can pick from when creating a project. MVP ships a single
 * product; future entries plug in additional connector implementations.
 */
const PRODUCT_OPTIONS: ReadonlyArray<{ id: ErpProvider; labelKey: string }> = [
  { id: 'k3cloud', labelKey: 'projects.products.k3cloud' }
];

interface ProjectFormProps {
  /** When present, the form opens in edit mode pre-populated with values. */
  initial?: Project;
  onSubmit: (input: {
    name: string;
    erpProvider: ErpProvider;
    bos: BosRpcCredentials;
  }) => void | Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

const DEFAULT_BOS: BosRpcCredentials = {
  baseUrl: 'http://localhost/k3cloud',
  acctId: '',
  username: '',
  password: '',
  devCode: 'PAIJ'
};

/**
 * Project form — three sections:
 *   1. Product (just K/3 Cloud for now)
 *   2. Identity — project name
 *   3. BOS login — server URL → discover account-sets → pick one → user/password
 *
 * Mirrors BOS Designer's login flow: the user enters only an HTTP endpoint
 * and a credential; we never need SQL Server reachability. Production
 * deployments where the SQL host is firewalled work the same as local dev.
 */
export function ProjectForm({ initial, onSubmit, onCancel, submitting }: ProjectFormProps) {
  const { t } = useTranslation();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [erpProvider, setErpProvider] = useState<ErpProvider>(
    initial?.erpProvider ?? PRODUCT_OPTIONS[0].id
  );
  const [bos, setBos] = useState<BosRpcCredentials>(initial?.bos ?? DEFAULT_BOS);

  // Edit mode keeps the saved acctId visible (as a single-entry dropdown
  // option) so the picker renders with the current value pre-selected;
  // clicking discover replaces the list with the live server result.
  const [bosDataCenters, setBosDataCenters] = useState<DataCenter[]>(
    initial?.bos?.acctId
      ? [{ id: initial.bos.acctId, number: '', name: initial.bos.acctId }]
      : []
  );
  const [discoveringBos, setDiscoveringBos] = useState(false);
  const [discoverBosError, setDiscoverBosError] = useState<string | null>(null);

  /**
   * List of currently-empty required fields, by their localized label. Used
   * to drive an inline hint next to the Save button — telling the user what
   * to fix is friendlier than a silently-disabled button.
   */
  const missingFields: string[] = [];
  if (name.trim().length === 0) missingFields.push(t('projects.name'));
  if (bos.baseUrl.trim().length === 0) missingFields.push(t('projects.bosBaseUrl'));
  if (bos.acctId.trim().length === 0) missingFields.push(t('projects.bosAcctId'));
  if (bos.username.trim().length === 0) missingFields.push(t('projects.bosUsername'));
  if (bos.password.length === 0) missingFields.push(t('projects.bosPassword'));

  /**
   * Discover the K/3 Cloud server's account-sets. Mirrors BOS Designer's
   * pre-login flow — no auth needed, server URL only. The result populates
   * the acctId dropdown so the user picks instead of hand-typing a 32-hex
   * GUID.
   */
  const discoverBos = async (): Promise<void> => {
    if (bos.baseUrl.trim().length === 0) return;
    setDiscoveringBos(true);
    setDiscoverBosError(null);
    try {
      const dcs = await window.opendeploy.projectsListDataCenters(bos.baseUrl.trim());
      setBosDataCenters(dcs);
      if (dcs.length === 0) {
        setDiscoverBosError(t('projects.bosNoAcctId'));
      } else if (!dcs.some((d) => d.id === bos.acctId)) {
        // Currently-typed acctId no longer matches any returned id — pre-pick
        // the first one to avoid leaving the user with an invalid stale value.
        setBos({ ...bos, acctId: dcs[0].id });
      }
    } catch (err) {
      setBosDataCenters([]);
      setDiscoverBosError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscoveringBos(false);
    }
  };

  const canSubmit = missingFields.length === 0;

  const submit = (): void => {
    if (!canSubmit || submitting) return;
    void onSubmit({
      name: name.trim(),
      erpProvider,
      bos: {
        baseUrl: bos.baseUrl.trim(),
        acctId: bos.acctId.trim(),
        username: bos.username.trim(),
        password: bos.password,
        devCode: bos.devCode.trim() || 'PAIJ'
      }
    });
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Row label={t('projects.product')} required>
        <select
          value={erpProvider}
          onChange={(e) => setErpProvider(e.target.value as ErpProvider)}
          disabled={isEdit}
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        >
          {PRODUCT_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.labelKey)}
            </option>
          ))}
        </select>
      </Row>

      <Row label={t('projects.name')} required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('projects.namePlaceholder')}
          style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <Row label={t('projects.bosBaseUrl')} required>
        <input
          type="text"
          value={bos.baseUrl}
          onChange={(e) => setBos({ ...bos, baseUrl: e.target.value })}
          placeholder="http://localhost/k3cloud"
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>
      <Hint>{t('projects.bosBaseUrlHint')}</Hint>
      <Row label={t('projects.bosAcctId')} required>
        <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {bosDataCenters.length > 0 ? (
            <select
              value={bos.acctId}
              onChange={(e) => setBos({ ...bos, acctId: e.target.value })}
              style={{ flex: 1, minWidth: 240, padding: '6px 10px', fontSize: 13 }}
            >
              <option value="">{t('projects.bosPickAcctId')}</option>
              {bosDataCenters.map((dc) => (
                <option key={dc.id} value={dc.id}>
                  {dc.number ? `${dc.number} · ${dc.name}` : dc.name} · {dc.id}
                </option>
              ))}
            </select>
          ) : (
            <span
              className="muted"
              style={{ flex: 1, fontSize: 12, fontStyle: 'italic' }}
            >
              {bos.baseUrl.trim().length > 0
                ? t('projects.bosPickAcctId')
                : t('projects.bosBaseUrlFirst')}
            </span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => void discoverBos()}
            disabled={bos.baseUrl.trim().length === 0 || discoveringBos || submitting}
          >
            {discoveringBos ? t('projects.bosDiscovering') : t('projects.bosDiscover')}
          </button>
        </div>
      </Row>
      {discoverBosError && (
        <div style={{ marginLeft: 112, fontSize: 12, color: 'var(--danger)' }}>
          {discoverBosError}
        </div>
      )}
      <Row label={t('projects.bosUsername')} required>
        <input
          type="text"
          value={bos.username}
          onChange={(e) => setBos({ ...bos, username: e.target.value })}
          placeholder="demo"
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>
      <Hint>{t('projects.bosUsernameHint')}</Hint>
      <Row label={t('projects.bosPassword')} required>
        <input
          type="password"
          value={bos.password}
          onChange={(e) => setBos({ ...bos, password: e.target.value })}
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>
      <Row label={t('projects.bosDevCode')}>
        <input
          type="text"
          value={bos.devCode}
          onChange={(e) => setBos({ ...bos, devCode: e.target.value })}
          placeholder="PAIJ"
          style={{ width: 160, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>
      <Hint>{t('projects.bosDevCodeHint')}</Hint>

      {/* ─── Actions ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginTop: 16,
          flexWrap: 'wrap'
        }}
      >
        {missingFields.length > 0 && (
          <span
            className="muted"
            style={{ fontSize: 12, color: 'var(--danger)' }}
          >
            {t('projects.missingFieldsHint', { list: missingFields.join('、') })}
          </span>
        )}
        <button type="button" className="btn" onClick={onCancel} disabled={submitting}>
          {t('projects.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={submit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? t('projects.saving') : t('projects.save')}
        </button>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="muted"
      style={{ marginLeft: 112, fontSize: 11, marginTop: -2, marginBottom: 2 }}
    >
      {children}
    </div>
  );
}

function Row({
  label,
  required,
  children
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <label
        style={{
          width: 100,
          fontSize: 12,
          color: 'var(--muted)',
          flexShrink: 0
        }}
      >
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <div style={{ flex: 1, display: 'flex' }}>{children}</div>
    </div>
  );
}
