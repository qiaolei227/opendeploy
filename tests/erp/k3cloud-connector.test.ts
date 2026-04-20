import { describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { K3CloudConnectionConfig } from '@shared/erp-types';

const config: K3CloudConnectionConfig = {
  server: 'localhost',
  database: 'AIS001',
  user: 'sa',
  password: '123',
  edition: 'standard',
  version: '9'
};

/**
 * Minimal stand-in for mssql's ConnectionPool. Only implements the methods
 * the connector touches — kept here to avoid mocking the full driver.
 */
function makeFakePool(opts: {
  queryResult?: { recordset: unknown[] };
  throwOnQuery?: Error;
  throwOnClose?: boolean;
  closeSpy?: () => void;
}): sql.ConnectionPool {
  const request = () => ({
    query: async <_T>() => {
      if (opts.throwOnQuery) throw opts.throwOnQuery;
      return opts.queryResult ?? { recordset: [] };
    },
    input: (_name: string, _type?: unknown, _val?: unknown) => request()
  });
  return {
    request,
    close: async () => {
      if (opts.throwOnClose) throw new Error('close failed');
      opts.closeSpy?.();
    }
  } as unknown as sql.ConnectionPool;
}

describe('K3CloudConnector.testConnection', () => {
  it('returns serverVersion on success', async () => {
    const openPool = vi.fn(async () =>
      makeFakePool({ queryResult: { recordset: [{ v: 'Microsoft SQL Server 2025' }] } })
    );
    const c = new K3CloudConnector(config, { openPool });

    const r = await c.testConnection();

    expect(r.ok).toBe(true);
    expect(r.serverVersion).toBe('Microsoft SQL Server 2025');
    expect(openPool).toHaveBeenCalledWith(config);
  });

  it('returns ok=false with error message when the probe pool fails to connect', async () => {
    const openPool = vi.fn(async () => {
      throw new Error('login failed for user sa');
    });
    const c = new K3CloudConnector(config, { openPool });

    const r = await c.testConnection();

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/login failed/);
  });

  it('returns ok=false when the query itself throws', async () => {
    const openPool = vi.fn(async () =>
      makeFakePool({ throwOnQuery: new Error('syntax error near @@VERSION') })
    );
    const c = new K3CloudConnector(config, { openPool });

    const r = await c.testConnection();

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/syntax error/);
  });

  it('closes the probe pool even when the query succeeds', async () => {
    const closeSpy = vi.fn();
    const openPool = vi.fn(async () =>
      makeFakePool({
        queryResult: { recordset: [{ v: 'x' }] },
        closeSpy
      })
    );
    const c = new K3CloudConnector(config, { openPool });

    await c.testConnection();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows a close() error so the success result still reaches the caller', async () => {
    const openPool = vi.fn(async () =>
      makeFakePool({ queryResult: { recordset: [{ v: 'x' }] }, throwOnClose: true })
    );
    const c = new K3CloudConnector(config, { openPool });

    await expect(c.testConnection()).resolves.toMatchObject({ ok: true });
  });
});

describe('K3CloudConnector connect/disconnect', () => {
  it('is idempotent on repeated connect', async () => {
    const openPool = vi.fn(async () => makeFakePool({}));
    const c = new K3CloudConnector(config, { openPool });

    await c.connect();
    await c.connect();

    expect(openPool).toHaveBeenCalledTimes(1);
  });

  it('calls pool.close on disconnect and allows reconnect', async () => {
    const closeSpy = vi.fn();
    const openPool = vi.fn(async () => makeFakePool({ closeSpy }));
    const c = new K3CloudConnector(config, { openPool });

    await c.connect();
    await c.disconnect();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    await c.connect();
    expect(openPool).toHaveBeenCalledTimes(2);
  });

  it('disconnect is a no-op when never connected', async () => {
    const openPool = vi.fn(async () => makeFakePool({}));
    const c = new K3CloudConnector(config, { openPool });

    await expect(c.disconnect()).resolves.toBeUndefined();
    expect(openPool).not.toHaveBeenCalled();
  });
});

describe('K3CloudConnector metadata methods (Task 12 placeholders)', () => {
  it('all metadata methods reject with not-implemented until Task 12', async () => {
    const c = new K3CloudConnector(config, { openPool: async () => makeFakePool({}) });
    await expect(c.listObjects()).rejects.toThrow(/not implemented/);
    await expect(c.getObject('x')).rejects.toThrow(/not implemented/);
    await expect(c.getFields('x')).rejects.toThrow(/not implemented/);
    await expect(c.listSubsystems()).rejects.toThrow(/not implemented/);
    await expect(c.searchMetadata('x')).rejects.toThrow(/not implemented/);
  });
});
