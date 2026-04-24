import { describe, it, expect } from 'vitest';
import { resolveProjectConfig } from '../../../scripts/bos-recon/config';

describe('resolveProjectConfig', () => {
  it('reads project config from a settings.json shape', () => {
    // 与 src/shared/erp-types.ts `Project.connection: K3CloudConnectionConfig` 对齐:
    //   顶层是 `connection` (不是 `k3cloud`), 字段名是 `server` (不是 `host`).
    const fakeSettings = {
      projects: [
        {
          id: 'proj-uat',
          erpProvider: 'k3cloud',
          connection: {
            server: 'localhost',
            port: 1433,
            database: 'AIS20260101',
            user: 'sa',
            password: 'Test@123',
            encrypt: true,
            trustServerCertificate: true
          }
        }
      ]
    };
    const cfg = resolveProjectConfig(fakeSettings, 'proj-uat');
    expect(cfg.database).toBe('AIS20260101');
    expect(cfg.server).toBe('localhost');
    expect(cfg.port).toBe(1433);
    expect(cfg.user).toBe('sa');
    expect(cfg.password).toBe('Test@123');
    expect(cfg.options?.encrypt).toBe(true);
  });

  it('throws when projectId not found', () => {
    const fakeSettings = {
      projects: [{ id: 'proj-a', erpProvider: 'k3cloud', connection: {} }]
    };
    expect(() => resolveProjectConfig(fakeSettings, 'missing')).toThrow(
      /project "missing" not found/
    );
  });

  it('throws when project is not a k3cloud project', () => {
    const fakeSettings = {
      projects: [{ id: 'proj-a', erpProvider: 'sap' }]
    };
    expect(() => resolveProjectConfig(fakeSettings, 'proj-a')).toThrow(
      /erpProvider "sap" not supported/
    );
  });
});
