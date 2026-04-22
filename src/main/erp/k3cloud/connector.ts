import sql from 'mssql';
import { openPool as defaultOpenPool } from '../pool';
import {
  getFields as qGetFields,
  getObject as qGetObject,
  listObjects as qListObjects,
  listSubsystems as qListSubsystems,
  searchMetadata as qSearchMetadata
} from './queries';
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

  private async requirePool(): Promise<sql.ConnectionPool> {
    if (!this.pool) {
      throw new Error('connector is not connected — call connect() first');
    }
    return this.pool;
  }

  /**
   * Expose the live pool for callers that need to run queries outside the
   * typed-query API (currently: the BOS write tools in `bos-writer.ts`
   * which need to issue INSERTs / UPDATEs the ErpConnector interface
   * doesn't cover). Same connection-state guarantees as `requirePool`.
   */
  async getPool(): Promise<sql.ConnectionPool> {
    return this.requirePool();
  }

  async listObjects(opts?: ListObjectsOptions): Promise<ObjectMeta[]> {
    return qListObjects(await this.requirePool(), opts);
  }

  async getObject(id: string, locale?: number): Promise<ObjectMeta | null> {
    return qGetObject(await this.requirePool(), id, locale);
  }

  async getFields(formId: string, locale?: number): Promise<FieldMeta[]> {
    return qGetFields(await this.requirePool(), formId, locale);
  }

  async listSubsystems(locale?: number): Promise<SubsystemMeta[]> {
    return qListSubsystems(await this.requirePool(), locale);
  }

  async searchMetadata(keyword: string, locale?: number): Promise<ObjectMeta[]> {
    return qSearchMetadata(await this.requirePool(), keyword, locale);
  }
}
