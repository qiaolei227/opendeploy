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
import { transformPatchedToExtensionWire } from './rpc/transform-extension-wire';
import { saveExtension, saveExtensionRaw, type SaveExtensionRawMeta } from './rpc/save-for-ide';
import { extractLayoutInfoOid } from './rpc/layout-discovery';
import { extractExistingExtensionElements } from './rpc/existing-elements';
import type {
  BosFormOperationElement,
  BosBarButtonElement,
  SaveExtensionRequest,
} from './rpc/types';
import { stripBarButtonFromAppearance } from './rpc/operation-parser';
import {
  buildAddEntityRuleOverlay,
  buildRemoveEntityRuleOverlay,
  buildFieldUpdateActionOverlay,
  inlineFieldUpdateActionInExt,
  injectOverlay,
  extractHeadEntityOid,
  extractFieldOid,
  type EntityServiceRuleService,
  type FieldUpdateActionService,
} from './rpc/business-rule-overlay';
import type { SaveExtensionResult } from './rpc/types';
import {
  parseBusinessRules,
  type ListBusinessRulesResult,
} from './rpc/business-rule-parser';
import type { ListOperationsResult } from './rpc/operation-types';
import { parseOperationsFromKernelXml } from './rpc/operation-parser';
import {
  // Lever 3 followup (2026-05-07): addToolbarButton / removeToolbarButton
  // migrated to Route B envelope rebuild. Only the appearance-location
  // extractors remain — they're parsers (read-only, no XML construction).
  extractFormAppearanceLocation,
  extractEntryEntityAppearanceLocation,
} from './rpc/appearance-locator';
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
   * the agent's `k3cloud_list_enum_types` browse without a second array.
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
   * ComboField name → GUID translation and the agent's `k3cloud_list_enum_types`
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
   * sub-entry, with display labels. Drives `k3cloud_get_form_layout` so the
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
   * `k3cloud_create_entry` to generate the `<int>` part of EntryName /
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
      // ConvertService.GetConvertRule rejects freshly-created DevType=2 +
      // FSTATUS=0 extensions with "在运行时不允许加载". Tolerate that — the
      // rule is in DB and version metadata can be fetched lazily on first
      // patch. 2026-05-02 实证: native Designer also doesn't load via the
      // runtime path right after create.
      let inheritPath: string | null = null;
      let version: string | null = null;
      let mainVersion: string | null = null;
      try {
        const desc = await getConvertRule(session, result.newExtensionId);
        inheritPath = desc.InheritPath ?? null;
        version = desc.Version ?? null;
        mainVersion = desc.MainVersion ?? null;
      } catch {
        // version metadata stays null; future patch ops will refetch
      }
      const patchBaseXml = buildPatchBaseXml({
        templateXml: baseline.extensionTemplateXml,
        newExtensionId: result.newExtensionId,
        displayName: displayName ?? '转换规则',
      });
      await saveConvertRuleExtState(this.projectId, {
        extId: result.newExtensionId,
        originRuleId,
        xml: patchBaseXml,
        inheritPath,
        version,
        mainVersion,
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

    const wireXml = transformPatchedToExtensionWire({
      patchedXml,
      originXml: baseline.originXml,
    });

    const result = await saveConvertRules(session, {
      rules: [
        { localeSlots: DEFAULT_LOCALE_SLOTS, source: baseline.originXml, paras: baseline.originParas },
        {
          localeSlots: DEFAULT_LOCALE_SLOTS,
          source: wireXml,
          paras: buildModifyExtensionParas({ extId, baseObjectId: state.originRuleId, isv }),
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

  /**
   * Inspect the origin rule of an extension and return its DefaultConvertPolicy
   * shape — the (sourceEntry, targetEntry) pairs that field mappings can mount
   * onto. Used by `k3cloud_add_convert_field_mapping`'s entry-consistency
   * validator to refuse multi-entry-mismatch wiring before it hits the bridge.
   *
   * Header-level entries surface as `''` (the K/3 convention — empty
   * SourceEntryKey / TargetEntryKey on the header DCP).
   */
  async describeOriginRuleDcps(extId: string): Promise<{
    originRuleId: string;
    sourceFormId: string;
    targetFormId: string;
    policies: Array<{ sourceEntry: string; targetEntry: string }>;
  }> {
    if (!this.projectId) throw new Error('connector not created with a projectId — cannot access ext state');
    const state = await loadConvertRuleExtState(this.projectId, extId);
    const raw = await getConvertRule(this.requireSession(), state.originRuleId);
    const rule = raw.Rule;
    const policies = (rule.Policies ?? [])
      .filter((p) => typeof p.___InstClassType__ === 'string' && p.___InstClassType__.endsWith('DefaultConvertPolicyElement'))
      .map((p) => ({
        sourceEntry: (p.SourceEntryKey as string | undefined) ?? '',
        targetEntry: (p.TargetEntryKey as string | undefined) ?? '',
      }));
    return {
      originRuleId: state.originRuleId,
      sourceFormId: rule.SourceFormId,
      targetFormId: rule.TargetFormId,
      policies,
    };
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

  /**
   * Add a plugin to the extension's plugin policy.
   *
   * `pyScript` blank/undefined → DLL plugin (className must be the fully-
   * qualified type, like `Kingdee.K3.SCM.App.ConvertPlugIn.MyConvertSrv`).
   * Wire emits `<ClassName>` only; PlugInType stays at the default 0 so the
   * server takes the DLL path.
   *
   * `pyScript` given → Python convert plugin (className may be a short
   * developer-chosen identifier). Wire emits `<PlugInType>1</PlugInType>` +
   * `<PyScript>...</PyScript>`; the server's `PythonConvertPlugIn` runs the
   * script through IronPython, with full access to the same 22 virtual
   * methods (`OnAfterCreateLink`, `OnAfterFieldMapping`, etc.) as DLL.
   * Verified against `frmplugInPolicyEditor.RegPyScript` (Designer's "注册
   * Python 脚本" handler) and `Kingdee.BOS.Core.Metadata.ConvertElement.PlugIn.PythonConvertPlugIn`.
   */
  async addConvertPlugin(
    extId: string,
    className: string,
    pyScript?: string,
    description?: string,
  ): Promise<SaveConvertRulesResult> {
    return this.patchExtXml(extId, 'add_convert_plugin', {
      class_name: className,
      ...(pyScript && pyScript.length > 0 ? { py_script: pyScript } : {}),
      ...(description && description.length > 0 ? { description } : {}),
    });
  }

  /** Remove a plugin (DLL or Python) from the extension's plugin policy by ClassName. */
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

  // ─── Business rules (Plan 5.12.3b) ─────────────────────────────────
  //
  // Path A: TS string-template overlay (validated by
  // `.scratch/probes/spike-bizrule-writeback.ts`). The bridge's typed
  // `add_entity_service_rule` op cannot run on real extension XML
  // because real extensions don't own a HeadEntity — that lives on the
  // parent. The wire shape BOS Designer ships is a minimal
  // `<HeadEntity action="edit" oid="..."><EntityServiceRules>...`
  // overlay injected before `</Elements>`. See `business-rule-overlay.ts`
  // for the full rationale.
  //
  // Field-level UpdateAction overlay (`addFieldUpdateAction`) replicates
  // the entity-level pattern: load extension stub + parent FKERNELXML,
  // resolve the target field's oid by walking the parent's XML for the
  // matching `<Key>` (`extractFieldOid`), build a
  // `<{FieldType} action="edit" oid="..."><UpdateActions>...` overlay,
  // inject before `</Elements>`, and ship via SaveForIDEV9. v0.1 ships
  // exactly one service per call (Calculate). Removal of field-level
  // UpdateActions is deferred to v0.2.

  /**
   * List all business rules (entity-level service rules + field-level
   * update actions) on an extension. Read-only.
   *
   * Implementation: fetch the extension's currently-persisted FKERNELXML
   * (which includes any HeadEntity overlay we previously pushed — the
   * server merges deltas into the persisted form) and let the bridge
   * walker emit the typed summary. Bridge ops on the read path work
   * because the FKERNELXML the server returns to us already contains the
   * HeadEntity collection.
   */
  /**
   * Walk the BaseObjectId chain (extension → parent extension → ... → root form)
   * looking for the FKERNELXML carrying `<HeadEntity oid="...">`. Multi-layer
   * extensions need this because each extension's FKERNELXML is a delta — only
   * the root form declares the HeadEntity element. The depth at which we
   * find the oid does not affect the wire (overlays target HeadEntity by
   * globally-unique oid).
   *
   * Returns the oid string, or null if the entire chain has no HeadEntity (which
   * happens for non-bill extensions like base data — they have no HeadEntity
   * concept; entity-level service rules are bill-only).
   *
   * The depth limit (5) is a paranoia guard against pathological cycles —
   * real extension chains rarely exceed 2-3 levels.
   */
  private async resolveHeadEntityOidViaChain(startId: string): Promise<string | null> {
    let currentId = startId;
    for (let depth = 0; depth < 5; depth++) {
      const xml = await this.getKernelXml(currentId);
      if (xml) {
        const oid = extractHeadEntityOid(xml);
        if (oid) return oid;
      }
      const obj = await this.getObject(currentId);
      if (!obj?.baseObjectId || obj.baseObjectId === currentId) return null;
      currentId = obj.baseObjectId;
    }
    return null;
  }

  async listBusinessRules(extensionFid: string): Promise<ListBusinessRulesResult> {
    const xml = await this.getKernelXml(extensionFid);
    if (!xml) throw new Error(`扩展 ${extensionFid} 无 FKERNELXML — 不存在或未持久化`);
    // Pure-TS parse — bridge.ListBusinessRules can't see <HeadEntity
    // action="edit"> overlays because BOS DcxmlSerializer drops them as
    // delta markers when no baseline metadata is loaded (bridge runs offline).
    // See `business-rule-parser.ts` header for the wire shapes we handle.
    return parseBusinessRules(xml);
  }

  /**
   * Add an entity-level business rule (EntityServiceRule) to an extension.
   *
   * Wire path: pull extension FKERNELXML stub + parent FKERNELXML for the
   * HeadEntity oid, build a string-template overlay, inject before
   * `</Elements>`, ship via `SaveForIDEV9`. Server merges, persists,
   * fills server-side defaults (PreConditionDesc setnull etc.).
   *
   * Each `services[]` entry must carry a caller-generated `id` (32-hex
   * GUID) — the server doesn't auto-generate service ids inside an overlay.
   */
  async addEntityServiceRule(args: {
    extensionFid: string;
    ruleId: string;
    description: string;
    preCondition: string;
    preConditionDesc?: string;
    services: EntityServiceRuleService[];
  }): Promise<{ ruleId: string }> {
    if (args.services.length === 0) {
      throw new Error('addEntityServiceRule: services must contain at least one entry');
    }
    const session = this.requireSession();

    const ext = await this.getObject(args.extensionFid);
    if (!ext) throw new Error(`扩展 ${args.extensionFid} 不存在`);
    if (!ext.baseObjectId) {
      throw new Error(`扩展 ${args.extensionFid} 缺少 BaseObjectId — 不是有效扩展`);
    }

    const extXml = await this.getKernelXml(args.extensionFid);
    if (!extXml) throw new Error(`扩展 ${args.extensionFid} 无 FKERNELXML`);

    // Walk baseObjectId chain to find HeadEntity oid. Multi-layer extensions
    // (二层扩展) have a parent that is itself an extension delta XML with no
    // `<HeadEntity>` node — only the root form (e.g. SAL_SaleOrder) carries
    // the HeadEntity declaration. Server-side `<HeadEntity action="edit" oid="...">`
    // overlays target by oid (globally unique), so the depth from which we
    // pulled the oid does not affect the wire — pull from whichever ancestor
    // has it.
    const parentHeadOid = await this.resolveHeadEntityOidViaChain(ext.baseObjectId);
    if (!parentHeadOid) {
      throw new Error(
        `从 ${ext.baseObjectId} 起 BaseObjectId 链上找不到 HeadEntity 节点 — 实体业务规则无法挂载`,
      );
    }

    const overlay = buildAddEntityRuleOverlay(parentHeadOid, {
      ruleId: args.ruleId,
      description: args.description,
      preCondition: args.preCondition,
      preConditionDesc: args.preConditionDesc,
      services: args.services,
    });
    const patchedXml = injectOverlay(extXml, overlay);

    const meta = await this.buildSaveExtensionRawMeta(session, args.extensionFid, ext);
    const result = await saveExtensionRaw(session, meta, patchedXml);
    if (!result.isSuccess) {
      throw new Error(
        `添加业务规则失败：${result.messageTitle ?? ''} ${result.messageDetail ?? '<no detail>'}`,
      );
    }
    return { ruleId: args.ruleId };
  }

  /**
   * Remove a business rule by id.
   *
   * Decides which overlay shape to emit by first listing rules (cheap
   * round-trip) — entity-level rules use the HeadEntity remove overlay
   * we ship today; field-level UpdateAction removal is deferred to
   * Task 3.5.
   */
  async removeBusinessRule(
    extensionFid: string,
    ruleId: string,
  ): Promise<{ location: 'entity' | 'field' }> {
    const session = this.requireSession();
    const ext = await this.getObject(extensionFid);
    if (!ext) throw new Error(`扩展 ${extensionFid} 不存在`);
    if (!ext.baseObjectId) {
      throw new Error(`扩展 ${extensionFid} 缺少 BaseObjectId — 不是有效扩展`);
    }

    const list = await this.listBusinessRules(extensionFid);
    const isEntity = list.entityRules.some((r) => r.ruleId === ruleId);
    const isField = list.fieldUpdateActions.some((a) => a.serviceId === ruleId);

    if (!isEntity && !isField) {
      throw new Error(`业务规则 ${ruleId} 在扩展 ${extensionFid} 中未找到`);
    }
    if (isField) {
      throw new Error(
        `field-level UpdateAction removal deferred to v0.2 — 字段级业务规则删除暂未实现`,
      );
    }

    const extXml = await this.getKernelXml(extensionFid);
    if (!extXml) throw new Error(`扩展 ${extensionFid} 无 FKERNELXML`);

    const parentHeadOid = await this.resolveHeadEntityOidViaChain(ext.baseObjectId);
    if (!parentHeadOid) {
      throw new Error(
        `父对象 ${ext.baseObjectId} 没有 HeadEntity 节点 — 实体业务规则无法定位`,
      );
    }

    const overlay = buildRemoveEntityRuleOverlay(parentHeadOid, ruleId);
    const patchedXml = injectOverlay(extXml, overlay);

    const meta = await this.buildSaveExtensionRawMeta(session, extensionFid, ext);
    const result = await saveExtensionRaw(session, meta, patchedXml);
    if (!result.isSuccess) {
      throw new Error(
        `删除业务规则失败：${result.messageTitle ?? ''} ${result.messageDetail ?? '<no detail>'}`,
      );
    }
    return { location: 'entity' };
  }

  /**
   * Add a field-level UpdateAction (Calculate / etc. that fires when the
   * field's value changes).
   *
   * Wire path mirrors `addEntityServiceRule`:
   *   1. Pull extension FKERNELXML stub + parent FKERNELXML
   *   2. Resolve the field's oid by walking the parent's XML for the
   *      `<Key>fieldKey</Key>` block — extension stubs don't carry oids for
   *      parent-original fields.
   *   3. Build `<{FieldType} action="edit" oid="..."><UpdateActions>...`
   *      overlay (Tier B recon §1, 2026-05-04 capture req-120).
   *   4. Inject before `</Elements>` and ship via `SaveForIDEV9`.
   *
   * v0.1 ships **one service per call**: a single Calculate UpdateAction.
   * Multi-service field actions (e.g. stacking Calculate + GetInvStock on
   * the same field) are out-of-scope — pending wire-format recon. The
   * caller-generated `id` is a dashed UUID matching the recon's
   * `<Id>afc25ea1-5732-4803-9f54-516a22fb0b09</Id>` shape.
   */
  async addFieldUpdateAction(args: {
    extensionFid: string;
    fieldKey: string;
    services: Array<{
      className?: string;
      actionId: number;
      id: string;
      parameters: string[];
      description?: string;
      disabledEvents?: string[];
    }>;
  }): Promise<{ serviceId: string }> {
    if (args.services.length !== 1) {
      throw new Error(
        'addFieldUpdateAction (v0.1): exactly one service per call — multi-service field UpdateActions deferred to v0.2',
      );
    }
    const session = this.requireSession();

    const ext = await this.getObject(args.extensionFid);
    if (!ext) throw new Error(`扩展 ${args.extensionFid} 不存在`);
    if (!ext.baseObjectId) {
      throw new Error(`扩展 ${args.extensionFid} 缺少 BaseObjectId — 不是有效扩展`);
    }

    const [extXml, parentXml] = await Promise.all([
      this.getKernelXml(args.extensionFid),
      this.getKernelXml(ext.baseObjectId),
    ]);
    if (!extXml) throw new Error(`扩展 ${args.extensionFid} 无 FKERNELXML`);
    if (!parentXml) {
      throw new Error(`父对象 ${ext.baseObjectId} 无 FKERNELXML — 无法定位字段 oid`);
    }

    // Two field-source paths with different wire formats:
    //   (1) Parent original field — overlay path: `<XField action="edit" oid=...>
    //       <UpdateActions>...</UpdateActions></XField>` appended to extension XML.
    //       The oid only exists in the parent's FKERNELXML.
    //   (2) Extension's own field (added via k3cloud_add_fields) — inline path:
    //       rewrite the field's existing block in extension XML to include
    //       `<FireUpdateEvent>1</FireUpdateEvent>` + `<UpdateActions>...</UpdateActions>`
    //       inside the field body. Capture req-120 (2026-05-04 recon) is the
    //       reference for this shape.
    // Wrong path → BOS server response_error "未能找到 XField 对应的数据类型"
    // (overlay path on extension field → server can't find the oid in base
    // metadata to merge into).
    const parentLocated = extractFieldOid(parentXml, args.fieldKey);
    const extLocated = parentLocated ? null : extractFieldOid(extXml, args.fieldKey);
    if (!parentLocated && !extLocated) {
      throw new Error(
        `字段 ${args.fieldKey} 在父对象 ${ext.baseObjectId} 或扩展 ${args.extensionFid} 上都未找到 — 无法挂载字段级 UpdateAction`,
      );
    }

    const svc = args.services[0];
    const overlayService: FieldUpdateActionService = {
      className: svc.className,
      actionId: svc.actionId,
      id: svc.id,
      parameters: svc.parameters,
      description: svc.description,
      disabledEvents: svc.disabledEvents,
    };

    let patchedXml: string;
    if (parentLocated) {
      const overlay = buildFieldUpdateActionOverlay(
        parentLocated.fieldType,
        parentLocated.oid,
        overlayService,
      );
      patchedXml = injectOverlay(extXml, overlay);
    } else {
      patchedXml = inlineFieldUpdateActionInExt(
        extXml,
        extLocated!.fieldType,
        extLocated!.oid,
        overlayService,
      );
    }

    const meta = await this.buildSaveExtensionRawMeta(session, args.extensionFid, ext);
    const result = await saveExtensionRaw(session, meta, patchedXml);
    if (!result.isSuccess) {
      throw new Error(
        `添加字段级 UpdateAction 失败：${result.messageTitle ?? ''} ${result.messageDetail ?? '<no detail>'}`,
      );
    }
    return { serviceId: svc.id };
  }

  // ─── Operations + toolbar buttons (Plan 5.12.6 Phase 3) ────────────
  // These wrappers feed the Phase 4 agent tools (k3cloud_list_operations /
  // _add_custom_operation / _remove_operation / _add_toolbar_button /
  // _remove_toolbar_button). Pattern mirrors the 5.12.3b business-rule
  // wrappers above:
  //   1. requireSession() / getObject(extensionFid) / getKernelXml(...)
  //   2. bridge.send('<op>', { xml, ...args })  ← bridge owns the DCXML
  //      reflection + pre-flight validation (dup keys, bound-op exists, ...).
  //   3. buildSaveExtensionRawMeta + saveExtensionRaw to ship via SaveForIDEV9.
  // listOperations is read-only — step 1 + 2 only, no save.

  /**
   * Enumerate FormOperations + toolbar BarButtonItems on an extension.
   *
   * Pure TS-side regex walk over the extension's FKERNELXML — see
   * `rpc/operation-parser.ts`. BOS's DcxmlSerializer drops `<Form action="edit">`
   * content without a parent baseline (memory `bos_bridge_list_operations_silent_drop`
   * — was the 5.12.6 "silent drop" scapegoat; real-server smoke 2026-05-07
   * proved DB persisted operations correctly, bridge reads couldn't see them),
   * so the bridge's `list_operations` op was deleted alongside its 4 sibling
   * write ops in the Plan 6 followup (2026-05-08).
   */
  async listOperations(extensionFid: string): Promise<ListOperationsResult> {
    const xml = await this.getKernelXml(extensionFid);
    if (!xml) {
      throw new Error(`扩展 ${extensionFid} 无 FKERNELXML — 不存在或未持久化`);
    }
    return parseOperationsFromKernelXml(xml);
  }

  /**
   * Append a custom FormOperation (default OperationId=45 / 自定义) to an
   * extension. When `pluginClassName` is non-empty the bridge also injects a
   * ServicePlugins/PlugIn entry (PlugInType=1, IronPython) carrying the
   * inline `pyBody` as ScriptString — this is the wire shape BOS uses to
   * persist a Python operation plugin without the customer running C# (recon
   * §3.3, capture req-96).
   *
   * `operationParameterId` is a caller-generated 32-hex GUID for the operation's
   * parameter slot; agents are expected to mint a UUID per call.
   */
  async addCustomOperation(args: {
    extensionFid: string;
    operationKey: string;
    operationName: string;
    operationParameterId: string;
    operationId?: number;
    pluginClassName?: string;
    pyBody?: string;
    operationObjectKey?: string;
    expressValue?: string;
  }): Promise<{ operationKey: string }> {
    const session = this.requireSession();

    const ext = await this.getObject(args.extensionFid);
    if (!ext) throw new Error(`扩展 ${args.extensionFid} 不存在`);

    const extXml = await this.getKernelXml(args.extensionFid);
    if (!extXml) throw new Error(`扩展 ${args.extensionFid} 无 FKERNELXML`);

    // Path A — string-template overlay matches register_python_plugins's
    // production-verified wire shape. Bridge baseline-diff route (Plan 5.12.6
    // initial design) was abandoned 2026-05-07 after spike #1 confirmed the
    // BOS DcxmlSerializer needs byte-exact primary-key match against parent
    // baseline; spike #2 surfaced the parent-element-wipe risk. See plan §
    // technical-debt notes + memory `followup_operation_overlay_to_bridge`.
    // Path A inject overlay was a dead end — fresh extension's FKERNELXML
    // lacks `<LayoutInfos>`, server silently drops adds that don't ship the
    // full envelope. Switching to the saveExtension(SaveExtensionRequest)
    // path register_python_plugins uses (production-verified): rebuild a
    // complete wire from existing-elements + new deltas via buildDcxmlSource.
    if (!ext.baseObjectId) {
      throw new Error(`扩展 ${args.extensionFid} 缺少 BaseObjectId — 无法 add_custom_operation`);
    }
    if (ext.modelTypeId == null || ext.subsystemId == null) {
      throw new Error(
        `扩展 ${args.extensionFid} 元数据不完整(modelTypeId=${ext.modelTypeId}, subsystemId=${ext.subsystemId})`,
      );
    }
    const parentXml = await this.getKernelXml(ext.baseObjectId);
    if (!parentXml) {
      throw new Error(`父对象 ${ext.baseObjectId} 无 FKERNELXML — 无法 add_custom_operation`);
    }
    const layoutInfoOid = extractLayoutInfoOid(parentXml);
    if (!layoutInfoOid) {
      throw new Error(`父对象 ${ext.baseObjectId} FKERNELXML 中未找到 layoutInfoOid`);
    }
    const existing = extractExistingExtensionElements(extXml);

    const newOp: BosFormOperationElement = {
      service: args.operationKey,
      operationId: args.operationId ?? 45,
      operationName: args.operationName,
      entryKey: args.operationObjectKey, // optional
      operationParameterId: args.operationParameterId,
      expressValue: args.expressValue,
      servicePlugin: args.pluginClassName
        ? { className: args.pluginClassName, pyBody: args.pyBody }
        : undefined,
    };

    const req: SaveExtensionRequest = {
      extension: {
        formId: ext.id,
        baseObjectId: ext.baseObjectId,
        modelTypeId: ext.modelTypeId,
        subSystemId: ext.subsystemId,
        name: [{ localeId: 2052, value: ext.name }],
        isv: { devCode: this.config.devCode },
      },
      isNew: false,
      layoutInfoOid,
      existingFieldsRaw: existing.fields,
      existingAppearancesRaw: existing.appearances,
      existingPluginsRaw: existing.plugins,
      existingEntriesRaw: existing.entries,
      existingEntryAppearancesRaw: existing.entryAppearances,
      existingTabPagesRaw: existing.tabPages,
      existingTabControlsRaw: existing.tabControls,
      existingFormOperationsRaw: existing.formOperations,
      addFormOperations: [newOp],
    };

    const result = await saveExtension(session, req);
    if (!result.isSuccess) {
      throw new Error(
        `添加自定义操作失败：${result.messageTitle ?? ''} ${result.messageDetail ?? '<no detail>'}`,
      );
    }
    return { operationKey: args.operationKey };
  }

  /**
   * Remove a FormOperation by operationKey. Route B (envelope rebuild) per
   * docs/architecture/bos-write-routes.md §3 — filter the targeted op out of
   * existing.formOperations and re-save the full envelope. Server applies
   * the stateful baseline diff: omitted = removed.
   *
   * Lever 3 migrated this off Route C overlay (commit on 2026-05-07). Route C
   * `buildRemoveOperationOverlay` + `injectIntoForm` are no longer called from
   * connector — kept around only for the addToolbarButton / removeToolbarButton
   * flows pending their own envelope migration (followup task — see
   * `docs/architecture/bos-write-routes.md` §3 Route C).
   */
  async removeOperation(extensionFid: string, operationKey: string): Promise<void> {
    const session = this.requireSession();

    const ext = await this.getObject(extensionFid);
    if (!ext) throw new Error(`扩展 ${extensionFid} 不存在`);
    if (!ext.baseObjectId) {
      throw new Error(`扩展 ${extensionFid} 缺少 BaseObjectId — 无法 remove_operation`);
    }
    if (ext.modelTypeId == null || ext.subsystemId == null) {
      throw new Error(
        `扩展 ${extensionFid} 元数据不完整(modelTypeId=${ext.modelTypeId}, subsystemId=${ext.subsystemId})`,
      );
    }

    const extXml = await this.getKernelXml(extensionFid);
    if (!extXml) throw new Error(`扩展 ${extensionFid} 无 FKERNELXML`);
    const parentXml = await this.getKernelXml(ext.baseObjectId);
    if (!parentXml) {
      throw new Error(`父对象 ${ext.baseObjectId} 无 FKERNELXML — 无法 remove_operation`);
    }
    const layoutInfoOid = extractLayoutInfoOid(parentXml);
    if (!layoutInfoOid) {
      throw new Error(`父对象 ${ext.baseObjectId} FKERNELXML 中未找到 layoutInfoOid`);
    }

    const existing = extractExistingExtensionElements(extXml);

    // Filter targeted op out of existing chunks. operationKey is asserted to be
    // a C-identifier upstream (no XML metachars) so a substring check on the
    // canonical `<Id>{key}</Id>` marker is safe.
    const idMarker = `<Id>${operationKey}</Id>`;
    const filteredOps = existing.formOperations.filter((op) => !op.includes(idMarker));
    if (filteredOps.length === existing.formOperations.length) {
      throw new Error(`操作 ${operationKey} 不存在`);
    }

    const req: SaveExtensionRequest = {
      extension: {
        formId: ext.id,
        baseObjectId: ext.baseObjectId,
        modelTypeId: ext.modelTypeId,
        subSystemId: ext.subsystemId,
        name: [{ localeId: 2052, value: ext.name }],
        isv: { devCode: this.config.devCode },
      },
      isNew: false,
      layoutInfoOid,
      existingFieldsRaw: existing.fields,
      existingAppearancesRaw: existing.appearances,
      existingPluginsRaw: existing.plugins,
      existingEntriesRaw: existing.entries,
      existingEntryAppearancesRaw: existing.entryAppearances,
      existingTabPagesRaw: existing.tabPages,
      existingTabControlsRaw: existing.tabControls,
      existingFormOperationsRaw: filteredOps,
    };

    const result = await saveExtension(session, req);
    if (!result.isSuccess) {
      throw new Error(
        `删除操作失败：${result.messageTitle ?? ''} ${result.messageDetail ?? '<no detail>'}`,
      );
    }
  }

  /**
   * Add a BarButtonItem (+ matching BarItemLink) to a form-level or
   * entry-level toolbar, bound to an existing FormOperation via
   * ActionId=23 / FormBusinessService.Parameters=["<opKey>"].
   *
   * `target.kind === 'form'` mounts on the FormAppearance; `'entry'`
   * requires an `entityKey` and mounts on the matching EntryEntityAppearance.
   * Bridge enforces:
   *   - boundOperationKey must reference an existing FormOperation
   *   - buttonKey must be unique across ALL appearances (matches BOS Designer)
   * Failures bubble as Chinese error messages from the bridge.
   *
   * `barDataManagerId` / `formBusinessServiceId` / `barItemLinkId` are
   * caller-generated GUIDs — BOS expects callers to supply ids for every
   * new metadata node within an overlay (no server-side auto-id).
   */
  async addToolbarButton(args: {
    extensionFid: string;
    /** `form` = FormAppearance.Menu (顶部工具栏);
     *  `list` = FormAppearance.ListMenu (列表菜单);
     *  `entry` = EntryEntityAppearance.Menu (单据体工具栏)。 */
    target: { kind: 'form' } | { kind: 'list' } | { kind: 'entry'; entityKey: string };
    buttonKey: string;
    buttonId: string;
    caption: string;
    seq: number;
    boundOperationKey: string;
    boundOperationName: string;
    toolbarKey: string;
    barDataManagerId: string;
    formBusinessServiceId: string;
    barItemLinkId: string;
  }): Promise<{ buttonKey: string }> {
    const session = this.requireSession();

    const ext = await this.getObject(args.extensionFid);
    if (!ext) throw new Error(`扩展 ${args.extensionFid} 不存在`);
    if (!ext.baseObjectId) {
      throw new Error(`扩展 ${args.extensionFid} 缺少 BaseObjectId — 无法 add_toolbar_button`);
    }
    if (ext.modelTypeId == null || ext.subsystemId == null) {
      throw new Error(
        `扩展 ${args.extensionFid} 元数据不完整(modelTypeId=${ext.modelTypeId}, subsystemId=${ext.subsystemId})`,
      );
    }

    const extXml = await this.getKernelXml(args.extensionFid);
    if (!extXml) throw new Error(`扩展 ${args.extensionFid} 无 FKERNELXML`);
    const parentXml = await this.getKernelXml(ext.baseObjectId);
    if (!parentXml) {
      throw new Error(`父对象 ${ext.baseObjectId} 无 FKERNELXML — 无法定位 appearance`);
    }
    const layoutInfoOid = extractLayoutInfoOid(parentXml);
    if (!layoutInfoOid) {
      throw new Error(`父对象 ${ext.baseObjectId} FKERNELXML 中未找到 layoutInfoOid`);
    }
    const loc =
      args.target.kind === 'form' || args.target.kind === 'list'
        ? extractFormAppearanceLocation(parentXml)
        : extractEntryEntityAppearanceLocation(parentXml, args.target.entityKey);
    if (!loc) {
      throw new Error(
        args.target.kind === 'form'
          ? `父对象 ${ext.baseObjectId} 没有 FormAppearance — form 顶层工具栏不存在`
          : args.target.kind === 'list'
          ? `父对象 ${ext.baseObjectId} 没有 FormAppearance — 列表菜单挂不上`
          : `父对象 ${ext.baseObjectId} 没有 entityKey "${args.target.entityKey}" 的 EntryEntityAppearance`,
      );
    }

    const existing = extractExistingExtensionElements(extXml);
    const newButton: BosBarButtonElement = {
      appearanceOid: loc.oid,
      appearanceKind:
        args.target.kind === 'entry' ? 'EntryEntityAppearance' : 'FormAppearance',
      menuWrapper: args.target.kind === 'list' ? 'ListMenu' : 'Menu',
      appearanceElementType: loc.elementType,
      buttonKey: args.buttonKey,
      buttonId: args.buttonId,
      caption: args.caption,
      seq: args.seq,
      boundOperationKey: args.boundOperationKey,
      boundOperationName: args.boundOperationName,
      toolbarKey: args.toolbarKey,
      barDataManagerId: args.barDataManagerId,
      formBusinessServiceId: args.formBusinessServiceId,
      barItemLinkId: args.barItemLinkId,
    };

    const req: SaveExtensionRequest = {
      extension: {
        formId: ext.id,
        baseObjectId: ext.baseObjectId,
        modelTypeId: ext.modelTypeId,
        subSystemId: ext.subsystemId,
        name: [{ localeId: 2052, value: ext.name }],
        isv: { devCode: this.config.devCode },
      },
      isNew: false,
      layoutInfoOid,
      existingFieldsRaw: existing.fields,
      existingAppearancesRaw: existing.appearances,
      existingPluginsRaw: existing.plugins,
      existingEntriesRaw: existing.entries,
      existingEntryAppearancesRaw: existing.entryAppearances,
      existingTabPagesRaw: existing.tabPages,
      existingTabControlsRaw: existing.tabControls,
      existingFormOperationsRaw: existing.formOperations,
      addBarButtons: [newButton],
    };

    const result = await saveExtension(session, req);
    if (!result.isSuccess) {
      throw new Error(
        `添加按钮失败：${result.messageTitle ?? ''} ${result.messageDetail ?? '<no detail>'}`,
      );
    }
    return { buttonKey: args.buttonKey };
  }

  /**
   * Remove a BarButtonItem (and its paired BarItemLink) by buttonKey.
   * Bridge walks every appearance's Menu/BarDataManager so the caller
   * doesn't have to know whether the button lived on form-level vs
   * entry-level toolbar.
   */
  async removeToolbarButton(extensionFid: string, buttonKey: string): Promise<void> {
    const session = this.requireSession();

    const ext = await this.getObject(extensionFid);
    if (!ext) throw new Error(`扩展 ${extensionFid} 不存在`);
    if (!ext.baseObjectId) throw new Error(`扩展 ${extensionFid} 缺少 BaseObjectId`);
    if (ext.modelTypeId == null || ext.subsystemId == null) {
      throw new Error(
        `扩展 ${extensionFid} 元数据不完整(modelTypeId=${ext.modelTypeId}, subsystemId=${ext.subsystemId})`,
      );
    }

    // Look up button details via list_operations (bridge read path) to get
    // the buttonId + barItemLinkId + parentEntityKey needed for the
    // declarative remove markers.
    const list = await this.listOperations(extensionFid);
    const button = list.toolbarButtons.find((b) => b.buttonKey === buttonKey);
    if (!button) throw new Error(`按钮 ${buttonKey} 不存在`);
    if (!button.buttonId) throw new Error(`按钮 ${buttonKey} 缺 BarButtonItem id — 无法删除`);
    if (!button.barItemLinkId) throw new Error(`按钮 ${buttonKey} 缺 BarItemLink id — 无法删除`);

    const extXml = await this.getKernelXml(extensionFid);
    if (!extXml) throw new Error(`扩展 ${extensionFid} 无 FKERNELXML`);
    const parentXml = await this.getKernelXml(ext.baseObjectId);
    if (!parentXml) throw new Error(`父对象 ${ext.baseObjectId} 无 FKERNELXML`);
    const layoutInfoOid = extractLayoutInfoOid(parentXml);
    if (!layoutInfoOid) {
      throw new Error(`父对象 ${ext.baseObjectId} FKERNELXML 中未找到 layoutInfoOid`);
    }
    const loc = button.parentEntityKey
      ? extractEntryEntityAppearanceLocation(parentXml, button.parentEntityKey)
      : extractFormAppearanceLocation(parentXml);
    if (!loc) {
      throw new Error(
        `父对象 ${ext.baseObjectId} 上找不到按钮 ${buttonKey} 对应的 appearance`,
      );
    }

    const existing = extractExistingExtensionElements(extXml);
    // Surgical filter: locate the FormAppearance / EntryEntityAppearance
    // chunk in existing.appearances containing this button, and either
    // (a) strip the BarButtonItem + BarItemLink inline, keeping the
    //     appearance for any other buttons it carries, or
    // (b) drop the entire appearance if the button was the only thing in
    //     it (server treats omission as remove via baseline diff — same
    //     pattern as removeOperation filter-existing-formOperations).
    //
    // We do NOT ship a separate `<FormAppearance action="edit" action="remove">`
    // sibling overlay. Tried that 2026-05-07 — server saw two overlays
    // with the same oid (existing + new sibling) and silently dropped the
    // sibling, leaving the button intact. See memory
    // `bos_smoke_findings_2026_05_07` finding 3.
    const filteredAppearances = existing.appearances
      .map((apXml) => stripBarButtonFromAppearance(apXml, button.buttonId!, button.barItemLinkId!))
      .filter((apXml): apXml is string => apXml !== null);

    const req: SaveExtensionRequest = {
      extension: {
        formId: ext.id,
        baseObjectId: ext.baseObjectId,
        modelTypeId: ext.modelTypeId,
        subSystemId: ext.subsystemId,
        name: [{ localeId: 2052, value: ext.name }],
        isv: { devCode: this.config.devCode },
      },
      isNew: false,
      layoutInfoOid,
      existingFieldsRaw: existing.fields,
      existingAppearancesRaw: filteredAppearances,
      existingPluginsRaw: existing.plugins,
      existingEntriesRaw: existing.entries,
      existingEntryAppearancesRaw: existing.entryAppearances,
      existingTabPagesRaw: existing.tabPages,
      existingTabControlsRaw: existing.tabControls,
      existingFormOperationsRaw: existing.formOperations,
    };

    const result = await saveExtension(session, req);
    if (!result.isSuccess) {
      throw new Error(
        `删除按钮失败：${result.messageTitle ?? ''} ${result.messageDetail ?? '<no detail>'}`,
      );
    }
  }

  /**
   * Hydrate the metadata envelope `saveExtensionRaw` needs for an existing
   * extension. Centralizes the extension-meta lookup so the business-rule
   * write paths don't each repeat the getObject / getIsv / oldId mechanics.
   */
  private async buildSaveExtensionRawMeta(
    session: KdSession,
    extensionFid: string,
    ext: { id: string; name: string; modelTypeId: number | null; subsystemId: string | null; baseObjectId: string | null },
  ): Promise<SaveExtensionRawMeta> {
    if (!ext.baseObjectId) {
      throw new Error(`扩展 ${extensionFid} 缺少 BaseObjectId`);
    }
    const isv = await this.getIsv(session);
    return {
      extId: extensionFid,
      oldId: extensionFid,
      extName: ext.name,
      modelTypeId: ext.modelTypeId ?? 0,
      baseObjectId: ext.baseObjectId,
      subSystemId: ext.subsystemId ?? '',
      isv,
    };
  }
}
