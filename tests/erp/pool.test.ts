import { describe, expect, it } from 'vitest';
import { buildPoolConfig } from '../../src/main/erp/pool';
import type { K3CloudConnectionConfig } from '@shared/erp-types';

const base: K3CloudConnectionConfig = {
  server: 'localhost',
  database: 'AIS001',
  user: 'sa',
  password: '123',
  edition: 'standard',
  version: '9'
};

describe('buildPoolConfig', () => {
  it('defaults port to 1433 when omitted', () => {
    const c = buildPoolConfig(base);
    expect(c.port).toBe(1433);
  });

  it('honors explicit port', () => {
    const c = buildPoolConfig({ ...base, port: 51735 });
    expect(c.port).toBe(51735);
  });

  it('defaults encryption on and trustServerCertificate on', () => {
    const c = buildPoolConfig(base);
    expect(c.options?.encrypt).toBe(true);
    expect(c.options?.trustServerCertificate).toBe(true);
  });

  it('passes through server / database / user / password', () => {
    const c = buildPoolConfig(base);
    expect(c.server).toBe('localhost');
    expect(c.database).toBe('AIS001');
    expect(c.user).toBe('sa');
    expect(c.password).toBe('123');
  });

  it('lets the caller flip encrypt off', () => {
    const c = buildPoolConfig({ ...base, encrypt: false });
    expect(c.options?.encrypt).toBe(false);
  });

  it('lets the caller require a CA-issued cert', () => {
    const c = buildPoolConfig({ ...base, trustServerCertificate: false });
    expect(c.options?.trustServerCertificate).toBe(false);
  });

  it('sets sensible pool bounds + timeouts', () => {
    const c = buildPoolConfig(base);
    expect(c.pool?.max).toBeGreaterThanOrEqual(1);
    expect(c.requestTimeout).toBeGreaterThan(0);
    expect(c.connectionTimeout).toBeGreaterThan(0);
  });
});
