/**
 * BOS-only K/3 Cloud connector. All read methods drive the K/3 Cloud Web
 * Server via HTTP RPC; no SQL Server connection involved.
 *
 * Why BOS-only:
 *   - Production deployments rarely expose SQL to consultants. The customer
 *     gives them an HTTP endpoint and a BOS account; no VPN, no SQL port.
 *   - The K/3 Cloud server already speaks every read we need:
 *       GetBusinessObjectMetaData     → returns SQLData + FKERNELXML
 *       GetExtendObjectTypeId         → list extension FIDs
 *       GetSubSystems / QueryObjectType / GetObjectTypes → catalog reads
 *
 * Session lifecycle:
 *   - `connect()` performs a login + HeartBeat probe; the resulting cookie
 *     state lives on `this.session` and is reused for every subsequent RPC.
 *   - `disconnect()` simply forgets the session — server-side TTL handles
 *     the rest. There's no explicit logout endpoint we want to commit to.
 *
 * Field/plugin parsers are reused verbatim from `queries.ts` — the on-wire
 * XML schema is identical to the one served from the SQL `FKERNELXML`
 * column, just wrapped in a `<MetaData>` envelope by the RPC layer.
 */

import {
  parseFieldsFromKernelXml,
  parseFormLayoutContainers,
  parseFormPluginsFromKernelXml,
  type FormLayout,
} from './fkernel-parsers';
import {
  getBusinessObjectMetaData,
  getExtendObjectTypeId,
  getObjectTypes,
  getSubSystems,
  queryObjectType,
  DEFAULT_LOCALE_ID,
} from './rpc/metadata';
import {
  getLookupObjects,
  indexByFormId,
  type LookupObject,
} from './rpc/lookup-objects';
import {
  getEnumObjectList,
  indexByEnumName,
  type EnumObjectSummary,
} from './rpc/enum-objects';
import { extractKernelXml, parseMetaDataXml } from './rpc/metadata-xml';
import { login } from './rpc/login';
import { getNextSequenceInt32 } from './rpc/sequence';
import type { KdSession } from './rpc/http-client';
import type {
  BosRpcCredentials,
  ExtensionMeta,
  FieldMeta,
  ObjectMeta,
  PluginMeta,
  SubsystemMeta,
  TestConnectionResult,
} from '@shared/erp-types';
import type { ErpConnector, ListObjectsOptions } from '../types';

/**
 * BOS RPC connector. One class serves all K/3 Cloud deployments
 * (V9/V10, standard/enterprise) — release/edition don't change how the
 * RPC behaves, only the SaveForIDE wire format slightly varies (handled
 * inside `rpc/save-for-ide.ts`).
 */
export class K3CloudConnector implements ErpConnector {
  private session: KdSession | null = null;
  /**
   * Lazy cache of T_META_LOOKUPCLASS entries (FormId → GUID). The full set
   * is ~1864 rows / 1 MB JSON; one fetch covers the whole session. We pay
   * the cost on first base_data / unit field translation, then reuse for
   * every subsequent write. Cleared by `disconnect()`.
   */
  private lookupObjectsByFormId: Map<string, LookupObject> | null = null;

  /**
   * Lazy cache of T_META_FORMENUM entries (~3500 rows / 700 KB). Used to
   * translate friendly enum names ("审核状态" / "OPENDEPLOY_TEST_ENUM") to
   * GUIDs that ComboField's `<EnumType>` requires. Mirrors the lookup-class
   * cache shape: case-insensitive name → entry; `[...map.values()]` covers
   * the agent's `kingdee_list_enum_types` browse without a second array.
   * Cleared by `disconnect()`.
   */
  private enumObjectsByName: Map<string, EnumObjectSummary> | null = null;

  constructor(public readonly config: BosRpcCredentials) {}

  /** Open the BOS session. Idempotent — second call no-ops. */
  async connect(): Promise<void> {
    if (this.session) return;
    const res = await login({
      baseUrl: this.config.baseUrl,
      acctId: this.config.acctId,
      username: this.config.username,
      password: this.config.password,
    });
    if (!res.isSuccess) {
      throw new Error(`BOS login failed: ${res.message ?? 'unknown'}`);
    }
    this.session = res.session;
  }

  /** Forget the cached session and any per-session caches. */
  async disconnect(): Promise<void> {
    this.session = null;
    this.lookupObjectsByFormId = null;
    this.enumObjectsByName = null;
  }

  /**
   * Probe: login + (later) HeartBeat. We don't call HeartBeat yet because
   * its response shape isn't compressed and our codec expects compression —
   * a successful login is itself proof that the server is reachable and
   * the credentials work, which is what the form needs.
   */
  async testConnection(): Promise<TestConnectionResult> {
    try {
      const res = await login({
        baseUrl: this.config.baseUrl,
        acctId: this.config.acctId,
        username: this.config.username,
        password: this.config.password,
      });
      if (!res.isSuccess) {
        return { ok: false, error: res.message ?? 'login failed' };
      }
      return { ok: true, serverVersion: '' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private requireSession(): KdSession {
    if (!this.session) throw new Error('connector is not connected — call connect() first');
    return this.session;
  }

  // ─── Catalog reads ─────────────────────────────────────────────────

  async listObjects(opts?: ListObjectsOptions): Promise<ObjectMeta[]> {
    const lcid = opts?.locale ?? DEFAULT_LOCALE_ID;
    const rows = await getObjectTypes(
      this.requireSession(),
      { subsystemIds: opts?.subsystemId ? [opts.subsystemId] : [] },
      lcid,
    );
    let out: ObjectMeta[] = rows.map((r) => ({
      id: r.id,
      name: r.name || r.id,
      modelTypeId: r.modelTypeId,
      subsystemId: r.subSystemId ?? null,
      baseObjectId: r.baseObjectId,
      isTemplate: false,
      modifyDate: null,
    }));
    const kw = opts?.keyword?.trim().toLowerCase();
    if (kw) {
      out = out.filter((o) => o.id.toLowerCase().includes(kw) || o.name.toLowerCase().includes(kw));
    }
    if (opts?.limit && out.length > opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  /**
   * Pull one object's header info. Implemented as
   * `getBusinessObjectMetaData` + `parseMetaDataXml` so we get the canonical
   * SQLData scalar columns plus the localized name from the `_L` row.
   *
   * Returns null when the server returns an empty Dictionary (= no such id).
   */
  async getObject(id: string, locale: number = DEFAULT_LOCALE_ID): Promise<ObjectMeta | null> {
    const md = await getBusinessObjectMetaData(this.requireSession(), id, [locale]);
    if (!md.metaData) return null;
    const env = parseMetaDataXml(md.metaData);
    const cols = env.columns;
    if (!cols['FID']) return null;

    // Localized name from metaData<lcid> envelope
    let name = cols['FID'] ?? id;
    const localized = md.metaDataByLocale[locale];
    if (localized) {
      try {
        const lEnv = parseMetaDataXml(localized);
        if (lEnv.columns['FNAME']) name = lEnv.columns['FNAME'];
      } catch {
        // ignore — keep id-based fallback
      }
    }
    return {
      id: cols['FID'] ?? id,
      name,
      modelTypeId: cols['FMODELTYPEID'] ? Number(cols['FMODELTYPEID']) : null,
      subsystemId: cols['FSUBSYSID'] || null,
      baseObjectId: cols['FBASEOBJECTID'] || null,
      isTemplate: cols['FISTEMPLATE'] === '1',
      modifyDate: cols['FMODIFYDATE'] || null,
    };
  }

  async getFields(formId: string, locale: number = DEFAULT_LOCALE_ID): Promise<FieldMeta[]> {
    const md = await getBusinessObjectMetaData(this.requireSession(), formId, [locale]);
    if (!md.metaData) return [];
    return parseFieldsFromKernelXml(extractKernelXml(md.metaData));
  }

  async listSubsystems(locale: number = DEFAULT_LOCALE_ID): Promise<SubsystemMeta[]> {
    return getSubSystems(this.requireSession(), locale);
  }

  async searchMetadata(keyword: string, locale: number = DEFAULT_LOCALE_ID): Promise<ObjectMeta[]> {
    const rows = await queryObjectType(this.requireSession(), keyword, locale);
    return rows.map((r) => ({
      id: r.id,
      name: r.name || r.id,
      modelTypeId: r.modelTypeId,
      subsystemId: null,
      baseObjectId: r.baseObjectId,
      isTemplate: false,
      modifyDate: null,
    }));
  }

  async getKernelXml(formId: string): Promise<string | null> {
    const md = await getBusinessObjectMetaData(this.requireSession(), formId, []);
    if (!md.metaData) return null;
    const xml = extractKernelXml(md.metaData);
    return xml || null;
  }

  /**
   * List every lookup-class registration the server knows about. Cached on
   * the connector — subsequent calls return the same map without re-fetching.
   * The data covers BD_Customer / BD_MATERIAL / BD_UNIT / BD_Department / etc.,
   * plus their lookup-class GUIDs (the value that goes into `<LookUpObjectID>`).
   *
   * Wire format: see `rpc/lookup-objects.ts` and the
   * `scripts/bos-recon/smoke-lookupobjects.ts` smoke.
   */
  async listLookupObjects(): Promise<Map<string, LookupObject>> {
    if (this.lookupObjectsByFormId) return this.lookupObjectsByFormId;
    const list = await getLookupObjects(this.requireSession(), { baseDataType: 400 });
    this.lookupObjectsByFormId = indexByFormId(list);
    return this.lookupObjectsByFormId;
  }

  /**
   * Resolve a friendly basedata FormId (e.g. "BD_Customer", "BD_UNIT") to its
   * lookup-class GUID. Case-insensitive match — `BD_Customer`, `BD_CUSTOMER`,
   * and `bd_customer` all resolve identically.
   *
   * Returns null when the FormId isn't a registered lookup class. Callers
   * surface a clear error to the user/agent (don't silently emit the friendly
   * key — BOS won't validate at save time but runtime form rendering will
   * fail with "未正确配置指向的基础资料").
   */
  async resolveLookupClassGuid(formId: string): Promise<LookupObject | null> {
    const map = await this.listLookupObjects();
    return map.get(formId.toLowerCase()) ?? null;
  }

  /**
   * Lazy fetch + cache the full enum-type list (~3500 rows). Used for
   * ComboField name → GUID translation and the agent's `kingdee_list_enum_types`
   * browse tool.
   */
  async listEnumObjects(): Promise<EnumObjectSummary[]> {
    const map = await this.ensureEnumIndex();
    return [...map.values()];
  }

  /**
   * Resolve a friendly enum name (zh-CN like "审核状态" or a developer string
   * like "OPENDEPLOY_TEST_ENUM") to its T_META_FORMENUM GUID. Case-insensitive.
   * Returns null when the name isn't registered.
   */
  async resolveEnumTypeGuid(enumName: string): Promise<EnumObjectSummary | null> {
    const map = await this.ensureEnumIndex();
    return map.get(enumName.toLowerCase()) ?? null;
  }

  /** Force a refresh of the enum cache — call after writing a new enum. */
  invalidateEnumCache(): void {
    this.enumObjectsByName = null;
  }

  private async ensureEnumIndex(): Promise<Map<string, EnumObjectSummary>> {
    if (!this.enumObjectsByName) {
      const all = await getEnumObjectList(this.requireSession());
      this.enumObjectsByName = indexByEnumName(all);
    }
    return this.enumObjectsByName;
  }

  /**
   * List extensions of a parent form. Implementation: ask the server for
   * the FID list (cheap), then pull each extension's metadata in parallel
   * to harvest name + developerCode + modifyDate.
   *
   * For parents with hundreds of extensions this could fan out widely;
   * caller is responsible for not calling on the universe. In practice
   * production extensions per form stay below a dozen.
   */
  async listExtensions(parentFormId: string, locale: number = DEFAULT_LOCALE_ID): Promise<ExtensionMeta[]> {
    const session = this.requireSession();
    const ids = await getExtendObjectTypeId(session, parentFormId);
    if (ids.length === 0) return [];
    const results = await Promise.all(
      ids.map(async (id) => {
        const md = await getBusinessObjectMetaData(session, id, [locale]);
        if (!md.metaData) return null;
        const env = parseMetaDataXml(md.metaData);
        const cols = env.columns;
        let name = id;
        const localized = md.metaDataByLocale[locale];
        if (localized) {
          try {
            name = parseMetaDataXml(localized).columns['FNAME'] || id;
          } catch {
            /* ignore */
          }
        }
        const ext: ExtensionMeta = {
          extId: cols['FID'] || id,
          parentFormId: cols['FBASEOBJECTID'] || parentFormId,
          name,
          developerCode: cols['FSUPPLIERNAME'] || null,
          modifyDate: cols['FMODIFYDATE'] || null,
        };
        return ext;
      }),
    );
    return results.filter((r): r is ExtensionMeta => r !== null);
  }

  async listFormPlugins(formOrExtId: string): Promise<PluginMeta[]> {
    const md = await getBusinessObjectMetaData(this.requireSession(), formOrExtId, []);
    if (!md.metaData) return [];
    return parseFormPluginsFromKernelXml(extractKernelXml(md.metaData));
  }

  /**
   * Return the form's container catalog: every header tab + every entry /
   * sub-entry, with display labels. Drives `kingdee_get_form_layout` so the
   * agent can list options to the user before adding fields.
   *
   * Returns null when the form doesn't exist; empty `{tabs, entries}` is a
   * valid result for forms without tabs/entries (rare; seen in some
   * lightweight base data).
   */
  async getFormLayout(formId: string): Promise<FormLayout | null> {
    const xml = await this.getKernelXml(formId);
    if (!xml) return null;
    return parseFormLayoutContainers(xml);
  }

  /**
   * Allocate the next int from the server's sequence allocator. Used by
   * `kingdee_create_entry` to generate the `<int>` part of EntryName /
   * TableName (`<DevCode>_Cust_Entry<int>` / `<DevCode>_t_Cust_Entry<int>`).
   *
   * Server reserves the int on call — no rollback. If a save fails after
   * allocation, the int is leaked (next call gets max+1). Acceptable for
   * v0.1 since BOS Designer leaks the same way.
   */
  async getNextSequenceInt32(category: string, increment: number = 1): Promise<number> {
    if (!this.session) throw new Error('Not connected');
    return getNextSequenceInt32(this.session, category, increment);
  }

  /** Expose session for the RPC write tools — they need a logged-in session for SaveForIDE / Delete. */
  getSession(): KdSession | null {
    return this.session;
  }
}
