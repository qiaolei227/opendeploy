import sql from 'mssql';
import type {
  DatabaseCandidate,
  K3CloudDiscoveryConfig,
  ListDatabasesResult
} from '@shared/erp-types';

const DEFAULT_PORT = 1433;

/**
 * Account-set discovery — runs *before* the user has picked a database, so
 * it logs into the server-level `master` database and lists user-visible
 * databases. K/3 Cloud account-sets follow the `AIS*` naming convention;
 * those float to the top, everything else (renamed legacy DBs etc.) comes
 * after so the user can still pick manually.
 *
 * Sits outside the validator white-list path on purpose: this is a fixed,
 * read-only, server-metadata query against `sys.databases` — not a business-
 * data query. It never runs through `K3CloudConnector` and therefore never
 * goes through `validateQuery()`.
 */
export async function listAccountDatabases(
  cfg: K3CloudDiscoveryConfig
): Promise<ListDatabasesResult> {
  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await new sql.ConnectionPool({
      server: cfg.server,
      port: cfg.port ?? DEFAULT_PORT,
      database: 'master',
      user: cfg.user,
      password: cfg.password,
      options: {
        encrypt: cfg.encrypt ?? true,
        trustServerCertificate: cfg.trustServerCertificate ?? true
      },
      pool: { max: 2, min: 0, idleTimeoutMillis: 10_000 },
      requestTimeout: 15_000,
      connectionTimeout: 10_000
    }).connect();

    const [dbs, ver] = await Promise.all([
      pool.request().query<{ name: string }>(
        `SELECT name FROM sys.databases
          WHERE name NOT IN ('master','model','msdb','tempdb')
          ORDER BY name`
      ),
      pool.request().query<{ v: string }>('SELECT @@VERSION AS v')
    ]);

    const databases: DatabaseCandidate[] = dbs.recordset.map((row) => ({
      name: row.name,
      isAccountSet: /^AIS/i.test(row.name)
    }));

    // Account-sets first (newest-looking names — higher strings — first),
    // non-AIS databases trail in alphabetical order.
    databases.sort((a, b) => {
      if (a.isAccountSet !== b.isAccountSet) return a.isAccountSet ? -1 : 1;
      if (a.isAccountSet) return b.name.localeCompare(a.name);
      return a.name.localeCompare(b.name);
    });

    return { ok: true, databases, serverVersion: ver.recordset[0]?.v ?? '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (pool) await pool.close().catch(() => undefined);
  }
}
