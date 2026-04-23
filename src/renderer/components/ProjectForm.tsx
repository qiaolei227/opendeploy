import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DatabaseCandidate,
  ErpProvider,
  K3CloudConnectionConfig,
  K3CloudDiscoveryConfig,
  ListDatabasesResult,
  Project
} from '@shared/erp-types';

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
    connection: K3CloudConnectionConfig;
  }) => void | Promise<void>;
  onCancel: () => void;
  /**
   * Combined connect-and-discover. Logs into `master` on the target server,
   * verifies credentials, returns server version + account-set candidates in
   * one round-trip. Drives the progressive-disclosure flow: until this
   * succeeds, the "target database" section is locked.
   */
  onListDatabases: (config: K3CloudDiscoveryConfig) => Promise<ListDatabasesResult>;
  submitting?: boolean;
}

const DEFAULT_CONNECTION: K3CloudConnectionConfig = {
  server: 'localhost',
  port: 1433,
  database: '',
  user: 'sa',
  password: '',
  encrypt: true,
  trustServerCertificate: true
};

/** Fields whose values invalidate a prior successful connect-and-discover. */
type CredentialField = 'server' | 'port' | 'user' | 'password' | 'encrypt' | 'trustServerCertificate';

/**
 * Project form with three progressive sections:
 *   1. Identity — project name.
 *   2. Server connection — credentials + a single "Connect & discover" button
 *      that verifies the server and lists account-sets in one round-trip.
 *   3. Target database — locked until step 2 succeeds; populated with the
 *      account-set dropdown returned by the discovery call.
 *
 * Edit mode starts with the connection pre-verified so the user can save
 * without reconnecting. Changing any credential field in step 2 invalidates
 * that state and forces a re-verify before save.
 */
export function ProjectForm({
  initial,
  onSubmit,
  onCancel,
  onListDatabases,
  submitting
}: ProjectFormProps) {
  const { t } = useTranslation();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [erpProvider, setErpProvider] = useState<ErpProvider>(
    initial?.erpProvider ?? PRODUCT_OPTIONS[0].id
  );
  const [c, setC] = useState<K3CloudConnectionConfig>(
    initial?.connection ?? DEFAULT_CONNECTION
  );
  // Edit mode opens with the connection assumed valid; creating a new project
  // starts unverified so section 3 stays locked until the user clicks discover.
  const [connectionVerified, setConnectionVerified] = useState(isEdit);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [databases, setDatabases] = useState<DatabaseCandidate[]>([]);
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  const credentialsFilled =
    c.server.trim().length > 0 && c.user.trim().length > 0 && c.password.length > 0;

  /**
   * Update a credential field and invalidate the verified flag so section 3
   * re-locks; user must reconnect before saving. Non-credential fields
   * (database / name) use `setC` directly.
   */
  const updateCredential = <K extends CredentialField>(
    key: K,
    value: K3CloudConnectionConfig[K]
  ): void => {
    setC({ ...c, [key]: value });
    if (connectionVerified) {
      setConnectionVerified(false);
      setServerVersion(null);
      setDiscoverError(null);
    }
  };

  const discover = async (): Promise<void> => {
    if (!credentialsFilled) return;
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const r = await onListDatabases({
        server: c.server,
        port: c.port,
        user: c.user,
        password: c.password,
        encrypt: c.encrypt,
        trustServerCertificate: c.trustServerCertificate
      });
      if (r.ok && r.databases) {
        setDatabases(r.databases);
        setServerVersion(r.serverVersion ?? null);
        setConnectionVerified(true);
        if (r.databases.length === 0) {
          setDiscoverError(t('projects.noDatabases'));
        }
      } else {
        setDatabases([]);
        setServerVersion(null);
        setConnectionVerified(false);
        setDiscoverError(r.error ?? t('projects.connectFailed'));
      }
    } catch (err) {
      setDatabases([]);
      setServerVersion(null);
      setConnectionVerified(false);
      setDiscoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  };

  const canSubmit =
    name.trim().length > 0 &&
    c.database.trim().length > 0 &&
    credentialsFilled &&
    connectionVerified;

  const submit = (): void => {
    if (!canSubmit || submitting) return;
    void onSubmit({ name: name.trim(), erpProvider, connection: c });
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {/* ─── Section 1: product ──────────────────────────────────────── */}
      <SectionTitle>{t('projects.sectionProduct')}</SectionTitle>
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

      {/* ─── Section 2: identity ─────────────────────────────────────── */}
      <SectionTitle>{t('projects.sectionIdentity')}</SectionTitle>
      <Row label={t('projects.name')} required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('projects.namePlaceholder')}
          style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      {/* ─── Section 2: server connection ────────────────────────────── */}
      <SectionTitle>{t('projects.sectionServer')}</SectionTitle>
      <Row label={t('projects.server')} required>
        <input
          type="text"
          value={c.server}
          onChange={(e) => updateCredential('server', e.target.value)}
          placeholder="localhost"
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>
      <Row label={t('projects.port')}>
        <input
          type="number"
          value={c.port ?? 1433}
          onChange={(e) => updateCredential('port', Number(e.target.value) || 1433)}
          style={{ width: 120, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>
      <Row label={t('projects.user')} required>
        <input
          type="text"
          value={c.user}
          onChange={(e) => updateCredential('user', e.target.value)}
          placeholder="sa"
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>
      <Row label={t('projects.password')} required>
        <input
          type="password"
          value={c.password}
          onChange={(e) => updateCredential('password', e.target.value)}
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <details style={{ marginLeft: 112, marginTop: 4 }}>
        <summary
          style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}
        >
          {t('projects.advancedToggle')}
        </summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={c.encrypt ?? true}
              onChange={(e) => updateCredential('encrypt', e.target.checked)}
            />
            <span>
              {t('projects.encrypt')} —{' '}
              <span style={{ color: 'var(--muted)' }}>{t('projects.encryptHint')}</span>
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={c.trustServerCertificate ?? true}
              onChange={(e) => updateCredential('trustServerCertificate', e.target.checked)}
            />
            <span>
              {t('projects.trustCert')} —{' '}
              <span style={{ color: 'var(--muted)' }}>{t('projects.trustCertHint')}</span>
            </span>
          </label>
        </div>
      </details>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginLeft: 112,
          marginTop: 12,
          flexWrap: 'wrap'
        }}
      >
        <button
          type="button"
          className="btn"
          onClick={() => void discover()}
          disabled={!credentialsFilled || discovering || submitting}
        >
          {discovering
            ? t('projects.connecting')
            : connectionVerified
              ? t('projects.reconnect')
              : t('projects.connectAndDiscover')}
        </button>
        {connectionVerified && (
          <span
            className="chip good"
            style={{
              fontSize: 12,
              color: 'var(--good)',
              padding: '4px 10px',
              maxWidth: 400,
              whiteSpace: 'normal',
              wordBreak: 'break-all'
            }}
            title={serverVersion ?? undefined}
          >
            {serverVersion
              ? t('projects.connectedWith', { version: shortenVersion(serverVersion) })
              : t('projects.connected')}
          </span>
        )}
        {discoverError && (
          <span style={{ fontSize: 12, color: 'var(--danger)' }}>{discoverError}</span>
        )}
      </div>

      {/* ─── Section 3: target database (locked until connected) ─────── */}
      <SectionTitle>{t('projects.sectionTargetDatabase')}</SectionTitle>
      <div
        style={{
          display: 'grid',
          gap: 8,
          opacity: connectionVerified ? 1 : 0.45,
          pointerEvents: connectionVerified ? 'auto' : 'none'
        }}
        aria-disabled={!connectionVerified}
      >
        {!connectionVerified && (
          <div
            className="muted small"
            style={{ marginLeft: 112, fontSize: 12, fontStyle: 'italic' }}
          >
            {t('projects.lockedUntilConnected')}
          </div>
        )}
        <Row label={t('projects.database')} required>
          {databases.length > 0 ? (
            <select
              value={c.database}
              onChange={(e) => setC({ ...c, database: e.target.value })}
              style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
            >
              <option value="">{t('projects.pickDatabase')}</option>
              {databases.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.isAccountSet ? `${d.name}  ·  ${t('projects.accountSet')}` : d.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={c.database}
              onChange={(e) => setC({ ...c, database: e.target.value })}
              placeholder="AIS..."
              style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
            />
          )}
        </Row>
      </div>

      {/* ─── Actions ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-title" style={{ margin: '20px 0 8px' }}>
      <h3>{children}</h3>
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

/**
 * `@@VERSION` strings look like
 * `Microsoft SQL Server 2022 (RTM-CU13) (KB5036432) - 16.0.4125.3 (X64) ...`.
 * Trim to the product line so the chip stays readable.
 */
function shortenVersion(v: string): string {
  const firstLine = v.split(/\r?\n/)[0] ?? v;
  const cut = firstLine.split(' - ')[0] ?? firstLine;
  return cut.length > 60 ? cut.slice(0, 60) + '…' : cut;
}
