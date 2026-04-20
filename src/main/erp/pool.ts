import sql from 'mssql';
import type { K3CloudConnectionConfig } from '@shared/erp-types';

/** Default TCP port when the config omits it. K/3 Cloud convention matches SQL Server default. */
const DEFAULT_PORT = 1433;

/**
 * Translate our user-facing `K3CloudConnectionConfig` into the driver-shaped
 * `sql.config`. Split out so that tests can assert the translation without
 * spinning up a real connection and so that the pool-manager has a single
 * canonical factory.
 */
export function buildPoolConfig(cfg: K3CloudConnectionConfig): sql.config {
  return {
    server: cfg.server,
    port: cfg.port ?? DEFAULT_PORT,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: cfg.encrypt ?? true,
      trustServerCertificate: cfg.trustServerCertificate ?? true
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000
    },
    requestTimeout: 30_000,
    connectionTimeout: 15_000
  };
}

/**
 * Open and return a live connection pool. Callers are responsible for closing
 * it — the pool-manager holds long-lived instances per project, throwaway
 * test-connection paths close right after a single probe.
 */
export async function openPool(cfg: K3CloudConnectionConfig): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool(buildPoolConfig(cfg));
  return pool.connect();
}
