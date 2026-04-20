import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  K3CloudConnectionConfig,
  K3CloudEdition,
  K3CloudVersion,
  Project
} from '@shared/erp-types';

interface ProjectFormProps {
  /** When present, the form opens in edit mode pre-populated with values. */
  initial?: Project;
  onSubmit: (input: { name: string; connection: K3CloudConnectionConfig }) => void | Promise<void>;
  onCancel: () => void;
  /** Test-connection handler; when provided, renders a "Test" button next to Save. */
  onTest?: (config: K3CloudConnectionConfig) => Promise<{ ok: boolean; serverVersion?: string; error?: string }>;
  submitting?: boolean;
}

const DEFAULT_CONNECTION: K3CloudConnectionConfig = {
  server: 'localhost',
  port: 1433,
  database: '',
  user: 'sa',
  password: '',
  edition: 'standard',
  version: '9',
  encrypt: true,
  trustServerCertificate: true
};

/**
 * Shared form for creating and editing a K/3 Cloud project. Minimal styling —
 * inline, matching SettingsPage / SkillsPage patterns so the look stays
 * consistent without inventing new CSS classes.
 */
export function ProjectForm({ initial, onSubmit, onCancel, onTest, submitting }: ProjectFormProps) {
  const { t } = useTranslation();

  const [name, setName] = useState(initial?.name ?? '');
  const [c, setC] = useState<K3CloudConnectionConfig>(
    initial?.connection ?? DEFAULT_CONNECTION
  );
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const canSubmit =
    name.trim().length > 0 &&
    c.server.trim().length > 0 &&
    c.database.trim().length > 0 &&
    c.user.trim().length > 0 &&
    c.password.length > 0;

  const submit = (): void => {
    if (!canSubmit || submitting) return;
    void onSubmit({ name: name.trim(), connection: c });
  };

  const test = async (): Promise<void> => {
    if (!onTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await onTest(c);
      setTestResult({
        ok: r.ok,
        message: r.ok
          ? r.serverVersion
            ? `${t('projects.testOk')} · ${r.serverVersion.slice(0, 80)}`
            : t('projects.testOk')
          : r.error ?? t('projects.testFailed')
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Row label={t('projects.name')} required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('projects.namePlaceholder')}
          style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <Row label={t('projects.server')} required>
        <input
          type="text"
          value={c.server}
          onChange={(e) => setC({ ...c, server: e.target.value })}
          placeholder="localhost"
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <Row label={t('projects.port')}>
        <input
          type="number"
          value={c.port ?? 1433}
          onChange={(e) => setC({ ...c, port: Number(e.target.value) || 1433 })}
          style={{ width: 120, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <Row label={t('projects.database')} required>
        <input
          type="text"
          value={c.database}
          onChange={(e) => setC({ ...c, database: e.target.value })}
          placeholder="AIS..."
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <Row label={t('projects.user')} required>
        <input
          type="text"
          value={c.user}
          onChange={(e) => setC({ ...c, user: e.target.value })}
          placeholder="sa"
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <Row label={t('projects.password')} required>
        <input
          type="password"
          value={c.password}
          onChange={(e) => setC({ ...c, password: e.target.value })}
          style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
        />
      </Row>

      <Row label={t('projects.edition')}>
        <select
          value={c.edition}
          onChange={(e) => setC({ ...c, edition: e.target.value as K3CloudEdition })}
          style={{ padding: '6px 10px', fontSize: 13 }}
        >
          <option value="standard">{t('projects.editionStandard')}</option>
          <option value="enterprise">{t('projects.editionEnterprise')}</option>
        </select>
      </Row>

      <Row label={t('projects.version')}>
        <select
          value={c.version}
          onChange={(e) => setC({ ...c, version: e.target.value as K3CloudVersion })}
          style={{ padding: '6px 10px', fontSize: 13 }}
        >
          <option value="9">V9</option>
          <option value="10">V10</option>
        </select>
      </Row>

      <Row label={t('projects.encrypt')}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={c.encrypt ?? true}
            onChange={(e) => setC({ ...c, encrypt: e.target.checked })}
          />
          {t('projects.encryptHint')}
        </label>
      </Row>

      <Row label={t('projects.trustCert')}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={c.trustServerCertificate ?? true}
            onChange={(e) => setC({ ...c, trustServerCertificate: e.target.checked })}
          />
          {t('projects.trustCertHint')}
        </label>
      </Row>

      {testResult && (
        <div
          className={`chip ${testResult.ok ? 'good' : ''}`}
          style={{
            fontSize: 12,
            color: testResult.ok ? 'var(--good)' : 'var(--danger)',
            padding: '6px 10px',
            whiteSpace: 'normal',
            wordBreak: 'break-all'
          }}
        >
          {testResult.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn" onClick={onCancel} disabled={submitting || testing}>
          {t('projects.cancel')}
        </button>
        {onTest && (
          <button
            type="button"
            className="btn"
            onClick={() => void test()}
            disabled={!canSubmit || testing || submitting}
          >
            {testing ? t('projects.testing') : t('projects.testConnection')}
          </button>
        )}
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
