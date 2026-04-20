import sql from 'mssql';
import { openPool as defaultOpenPool } from '../pool';
import type {
  FieldMeta,
  K3CloudConnectionConfig,
  ObjectMeta,
  SubsystemMeta,
  TestConnectionResult
} from '@shared/erp-types';
import type { ErpConnector, ListObjectsOptions } from '../types';

/** Dependency-injection seam so tests can pass a fake pool factory. */
export interface K3CloudConnectorDeps {
  openPool?: (cfg: K3CloudConnectionConfig) => Promise<sql.ConnectionPool>;
}

/**
 * K/3 Cloud connector. One class serves all editions (standard / enterprise);
 * edition-specific divergence, if any, lives inside individual methods. See
 * memory `project_plan_4_decisions`.
 *
 * Task 6 implements connect / disconnect / testConnection only. Metadata
 * methods throw `not implemented` until Task 12 populates them with the
 * real SQL against T_META_OBJECTTYPE / T_META_OBJECTTYPE_L / T_META_SUBSYSTEM.
 */
export class K3CloudConnector implements ErpConnector {
  private pool: sql.ConnectionPool | null = null;
  private readonly openPool: (cfg: K3CloudConnectionConfig) => Promise<sql.ConnectionPool>;

  constructor(
    public readonly config: K3CloudConnectionConfig,
    deps: K3CloudConnectorDeps = {}
  ) {
    this.openPool = deps.openPool ?? defaultOpenPool;
  }

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = await this.openPool(this.config);
  }

  async disconnect(): Promise<void> {
    const p = this.pool;
    this.pool = null;
    if (p) await p.close();
  }

  /**
   * Probe the server with `SELECT @@VERSION`. Uses a throwaway pool so the
   * caller doesn't accidentally keep a live connection for a UI "test" button
   * press. The long-lived `connect()` pool is untouched.
   */
  async testConnection(): Promise<TestConnectionResult> {
    let probe: sql.ConnectionPool | null = null;
    try {
      probe = await this.openPool(this.config);
      const result = await probe.request().query<{ v: string }>('SELECT @@VERSION AS v');
      return { ok: true, serverVersion: result.recordset[0]?.v ?? '' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (probe) {
        // best-effort close; if it throws, the pool was never live anyway
        await probe.close().catch(() => undefined);
      }
    }
  }

  listObjects(_opts?: ListObjectsOptions): Promise<ObjectMeta[]> {
    return Promise.reject(new Error('K3CloudConnector.listObjects: not implemented (Plan 4 Task 12)'));
  }

  getObject(_id: string, _locale?: number): Promise<ObjectMeta | null> {
    return Promise.reject(new Error('K3CloudConnector.getObject: not implemented (Plan 4 Task 12)'));
  }

  getFields(_formId: string, _locale?: number): Promise<FieldMeta[]> {
    return Promise.reject(new Error('K3CloudConnector.getFields: not implemented (Plan 4 Task 12)'));
  }

  listSubsystems(_locale?: number): Promise<SubsystemMeta[]> {
    return Promise.reject(new Error('K3CloudConnector.listSubsystems: not implemented (Plan 4 Task 12)'));
  }

  searchMetadata(_keyword: string, _locale?: number): Promise<ObjectMeta[]> {
    return Promise.reject(new Error('K3CloudConnector.searchMetadata: not implemented (Plan 4 Task 12)'));
  }
}
