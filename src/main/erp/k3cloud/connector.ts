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
import { getAllConvertPaths, getConvertRule } from './rpc/convert-rules';
import {
  summarizeConvertPath,
  summarizeConvertRule,
  type ConvertRulePathSummary,
  type ConvertRuleSummary,
} from './convert-rule-summarizer';
import {
  extendConvertRule as rpcExtendConvertRule,
  deleteConvertRuleExtension as rpcDeleteConvertRuleExtension,
  type ExtendConvertRuleResult,
} from './rpc/extend-convert-rule';
import {
  UnsupportedConvertRuleError,
  type ConvertRuleBaseline,
  DEFAULT_LOCALE_SLOTS,
} from './rpc/convert-rule-baselines';
import { getCurrentIsv } from './rpc/get-current-isv';
import {
  buildModifyExtensionParas,
  type IsvDescriptor,
  type ConvertRuleEnvelope,
  type SaveConvertRulesResult,
} from './rpc/save-convert-rules';
import { saveConvertRules } from './rpc/save-convert-rules';
import {
  saveConvertRuleExtState,
  loadConvertRuleExtState,
} from './rpc/convert-rule-state';
import { buildPatchBaseXml } from './rpc/build-patch-base-xml';
import { getBridge } from './bridge';
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

  /** Memoized for the session — ISV is the developer's installation key, fixed
   *  per data center. Cleared in `disconnect()` so a reconnect re-probes it. */
  private cachedIsv: IsvDescriptor | null = null;

  constructor(
    public readonly config: BosRpcCredentials,
    private readonly convertRuleBaselines: Record<string, ConvertRuleBaseline> = {},
    /** Project ID for on-disk state (convert-rule-ext XML, backups). */
    private readonly projectId?: string,
  ) {}

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
    this.cachedIsv = null;
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

  // ─── Convert rules (read-only — Plan 5.12.4) ───────────────────────

  /**
   * List system-wide source→target conversion paths. The server returns the
   * full table (~hundreds of entries); we filter by sourceFormId on the
   * client when caller wants to scope.
   *
   * The list does not include rule ids — those follow the BOS naming
   * convention (`<SourceShort>-<TargetShort>`) and are derived inside
   * `describeConvertRule`. When two rules map the same path (default + variant),
   * GetAllPaths returns the path once; describing each variant would need
   * the per-rule LoadByModelType BinaryFormatter path which we don't support.
   */
  async listConvertRules(sourceFormId?: string): Promise<ConvertRulePathSummary[]> {
    const all = await getAllConvertPaths(this.requireSession());
    const filtered = sourceFormId
      ? all.filter((p) => p.SourceFormId === sourceFormId)
      : all;
    return filtered.map(summarizeConvertPath);
  }

  /**
   * Pull one rule's full definition and compress it into an LLM-friendly
   * summary. The raw response is ~240 KB JSON for a typical SAL rule;
   * summarizer drops Auto-mapped FieldMaps and Id/Key noise, leaving
   * Formula maps + GroupBy + Plugins + BillTypeMaps + the few essentials.
   *
   * Throws when the ruleId doesn't exist (server returns response_error).
   */
  async describeConvertRule(ruleId: string): Promise<ConvertRuleSummary> {
    const raw = await getConvertRule(this.requireSession(), ruleId);
    return summarizeConvertRule(raw);
  }

  // ─── Convert rules (write) ─────────────────────────────────────────
  //
  // v0.1 ships baselines for `SaleOrder-OutStock` only — generalizing
  // requires a TS port of `DcxmlSerializer` or per-rule baseline capture.
  // Throws `UnsupportedConvertRuleError` for any other ruleId; tool layer
  // routes that to a friendly user message.

  private requireBaseline(op: string, originRuleId: string): ConvertRuleBaseline {
    const baseline = this.convertRuleBaselines[originRuleId];
    if (!baseline) throw new UnsupportedConvertRuleError(op, originRuleId);
    return baseline;
  }

  /**
   * Build the ISV descriptor for SaveRulesV9.
   *
   * `Id` is the BOS Designer activation key — the server requires it for
   * ISV lineage and rejects null with a NullReferenceException, so we
   * fetch it from `GetCurrentISV` (memoized per session).
   *
   * `Name` and `DevCode` use the project's `devCode` so OpenDeploy-built
   * extensions group with the customer's other work in BOS Designer
   * rather than under whatever default ISV the data center returns.
   *
   * `ISVSignal` is forced to "Kingdee" — real BOS Designer captures
   * always show this value, but `GetCurrentISV` on some data centers
   * returns it empty. The mismatch can confuse server-side lineage
   * checks and cause extensions to appear as siblings of their origin
   * rule rather than children.
   */
  private async getIsv(session: KdSession): Promise<IsvDescriptor> {
    if (this.cachedIsv) return this.cachedIsv;
    const remote = await getCurrentIsv(session);
    this.cachedIsv = {
      Id: remote.Id,
      Name: this.config.devCode,
      ISVSignal: 'Kingdee',
      PackageSignal: remote.PackageSignal ?? '',
      DevCode: this.config.devCode,
    };
    return this.cachedIsv;
  }

  async extendConvertRule(
    originRuleId: string,
    displayName?: string,
  ): Promise<ExtendConvertRuleResult> {
    const session = this.requireSession();
    const baseline = this.requireBaseline('extendConvertRule', originRuleId);
    const isv = await this.getIsv(session);
    const result = await rpcExtendConvertRule(session, { baseline, isv, displayName });
    // Persist state so subsequent patch operations have a base XML to work with.
    //
    // The wire `result.extensionXml` is the 275-byte minimal body the server
    // got — that's right for SaveRulesV9 (server inherits Policies via
    // BaseObjectId) but **wrong for the local patch base**: the bridge's
    // FindDefaultConvertPolicy/RequirePolicy<T> need the Policy schemas
    // present in the deserialized object. We rebuild the patch base from the
    // bundled extension template (full Policy shells) with cleared FieldMaps.
    // See `build-patch-base-xml.ts` for the full rationale.
    if (result.ok && this.projectId) {
      const desc = await getConvertRule(session, result.newExtensionId);
      const patchBaseXml = buildPatchBaseXml({
        templateXml: baseline.extensionTemplateXml,
        newExtensionId: result.newExtensionId,
        displayName: displayName ?? '转换规则',
      });
      await saveConvertRuleExtState(this.projectId, {
        extId: result.newExtensionId,
        originRuleId,
        xml: patchBaseXml,
        inheritPath: desc.InheritPath ?? null,
        version: desc.Version ?? null,
        mainVersion: desc.MainVersion ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return result;
  }

  /**
   * Load extension state, call a bridge patch op on the XML, persist the result,
   * and re-save via SaveRulesV9. All patch operations share this pattern.
   */
  private async patchExtXml(
    extId: string,
    op: string,
    bridgeArgs: Record<string, unknown>,
  ): Promise<SaveConvertRulesResult> {
    if (!this.projectId) throw new Error('connector not created with a projectId — cannot access ext state');
    const state = await loadConvertRuleExtState(this.projectId, extId);
    const baseline = this.requireBaseline(op, state.originRuleId);
    const session = this.requireSession();
    const [isv, bridge] = await Promise.all([this.getIsv(session), getBridge()]);
    const { xml: patchedXml } = await bridge.send<{ xml: string }>(op, { xml: state.xml, ...bridgeArgs });

    const result = await saveConvertRules(session, {
      rules: [
        { localeSlots: DEFAULT_LOCALE_SLOTS, source: baseline.originXml, paras: baseline.originParas },
        {
          localeSlots: DEFAULT_LOCALE_SLOTS,
          source: patchedXml,
          paras: buildModifyExtensionParas({ extId, isv, inheritPath: state.inheritPath, version: state.version, mainVersion: state.mainVersion }),
        },
      ],
      oldIds: [baseline.originParas.Id, extId],
      isv,
    });

    if (result.ok) {
      await saveConvertRuleExtState(this.projectId, { ...state, xml: patchedXml, updatedAt: new Date().toISOString() });
    }
    return result;
  }

  /** Add a FieldMap to an extension's DefaultConvertPolicy. */
  async addConvertFieldMapping(
    extId: string,
    targetFieldKey: string,
    sourceFieldKey: string,
    mode: string,
    formula?: string,
    targetEntryKey?: string,
  ): Promise<SaveConvertRulesResult> {
    return this.patchExtXml(extId, 'add_convert_field_map', {
      target_field_key: targetFieldKey,
      source_field_key: sourceFieldKey,
      mode,
      ...(formula != null ? { formula } : {}),
      ...(targetEntryKey != null ? { target_entry_key: targetEntryKey } : {}),
    });
  }

  /** Replace the GroupBy strategy on an extension. */
  async setConvertGroupBy(
    extId: string,
    mode: string,
    field1?: string,
    field2?: string,
    field3?: string,
    formula?: string,
  ): Promise<SaveConvertRulesResult> {
    return this.patchExtXml(extId, 'set_convert_group_by', {
      mode,
      ...(field1 != null ? { field1 } : {}),
      ...(field2 != null ? { field2 } : {}),
      ...(field3 != null ? { field3 } : {}),
      ...(formula != null ? { formula } : {}),
    });
  }

  /** Set the filter policy's alert message and/or IronPython filter expression. */
  async setConvertFilter(
    extId: string,
    alertMessage?: string,
    custFilter?: string,
  ): Promise<SaveConvertRulesResult> {
    return this.patchExtXml(extId, 'set_convert_filter', {
      ...(alertMessage != null ? { alert_message: alertMessage } : {}),
      ...(custFilter != null ? { cust_filter: custFilter } : {}),
    });
  }

  /** Add a DLL plugin class to the extension's plugin policy. */
  async addConvertPlugin(extId: string, className: string): Promise<SaveConvertRulesResult> {
    return this.patchExtXml(extId, 'add_convert_plugin', { class_name: className });
  }

  /** Remove a DLL plugin class from the extension's plugin policy. */
  async removeConvertPlugin(extId: string, className: string): Promise<SaveConvertRulesResult> {
    return this.patchExtXml(extId, 'remove_convert_plugin', { class_name: className });
  }

  /** Add or replace a BillTypeMap entry in the extension. */
  async addConvertBillTypeMap(
    extId: string,
    sourceBillTypeId: string,
    targetBillTypeId: string,
  ): Promise<SaveConvertRulesResult> {
    return this.patchExtXml(extId, 'add_convert_bill_type_map', {
      source_bill_type_id: sourceBillTypeId,
      target_bill_type_id: targetBillTypeId,
    });
  }

  async deleteConvertRuleExtension(
    originRuleId: string,
    extId: string,
  ): Promise<SaveConvertRulesResult> {
    const session = this.requireSession();
    const baseline = this.requireBaseline('deleteConvertRuleExtension', originRuleId);
    const isv = await this.getIsv(session);
    return rpcDeleteConvertRuleExtension(session, { baseline, extId, isv });
  }
}
