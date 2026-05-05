/**
 * High-level SaveForIDEV9 wrapper — typed `SaveExtensionRequest` →
 * application-layer payload → HTTP RPC → typed `SaveExtensionResult`.
 *
 * Composes:
 *   - dcxml.buildDcxmlSource(req)          → DCXML body string
 *   - JSON.stringify({ __source__, __paras__, "<lcid>": ... }) → ap0 plaintext
 *   - codec.encodeAppLayer(ap0)            → base64+zlib
 *   - http-client.callKdsvc(...)           → POST and decode response
 *   - JSON.parse(bodyText) as IDEOperateResult → typed result
 *
 * Wire format reference: memory `bos_save_for_ide_v9_wire_format.md`.
 */

import { SaveExtensionRequest, SaveExtensionResult } from './types';
import { buildDcxmlSource } from './dcxml';
import { encodeApField, callKdsvc, applySetCookieToSession, parseJsonResponse, KdSession } from './http-client';
import type { IsvDescriptor } from './save-convert-rules';

const METADATA_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';
const ZH_CN_LCID = 2052;

/** Build the `__paras__` JSON-string-in-JSON value for SaveForIDEV9. */
export function buildParas(req: SaveExtensionRequest): string {
  const ext = req.extension;
  const isv = {
    Id: ext.isv.id ?? ext.isv.devCode,
    Name: ext.isv.name ?? ext.isv.devCode,
    ISVSignal: ext.isv.isvSignal ?? 'Kingdee',
    PackageSignal: ext.isv.packageSignal ?? '',
    DevCode: ext.isv.devCode,
  };
  const nameJson = JSON.stringify(ext.name.map((n) => ({ Key: n.localeId, Value: n.value })));
  // OldId semantics observed in capture: null on first save (isNew),
  // equals current Id on subsequent saves of the same extension. Used by
  // server to detect rename (where it would differ from Id). Override via
  // ext.oldId when explicitly renaming.
  const oldId = ext.oldId !== undefined ? ext.oldId : (req.isNew ? null : ext.formId);
  const paras = {
    Id: ext.formId,
    OldId: oldId,
    ModelTypeId: ext.modelTypeId,
    BaseObjectId: ext.baseObjectId,
    DevType: 2,
    SubSystemId: ext.subSystemId,
    Version: null,
    PackageId: null,
    HasExtends: false,
    RunTime: false,
    LayoutViewId: null,
    OldLayoutViewId: null,
    LayoutViewVersion: null,
    DependencyObjectId: null,
    FirstNonExtendObjectID: ext.baseObjectId,
    ISV: isv,
    UpdateIdToKey: false,
    SourceFormId: null,
    InheritPath: null,
    IsInheritElement: false,
    ModelTypeSubId: ext.modelTypeId,
    MainVersion: null,
    Name: nameJson,
    // FuncInterfaces: TODO — observed populated when extension inherits parent's
    // function interfaces (e.g. UpdateCreditAmount on SAL_SaleOrder). Server
    // accepts null in some scenarios but populated mirrors original. Investigate
    // when first save succeeds without it; otherwise capture again with the
    // exact baseObjectId in use.
    FuncInterfaces: null,
  };
  return JSON.stringify(paras);
}

/** Build the `ap0` plaintext (DCXML envelope) before app-layer compression. */
export function buildAp0Plain(req: SaveExtensionRequest): string {
  const dcxml = buildDcxmlSource(req);
  const ap0Object: Record<string, string> = {
    __source__: dcxml,
    __paras__: buildParas(req),
  };
  for (const localized of req.extension.name) {
    // Empty per-locale string in observed samples (the source already has
    // the names embedded). Populated when locale-specific layout overrides
    // are present — not yet supported.
    ap0Object[String(localized.localeId)] = '';
  }
  return JSON.stringify(ap0Object);
}

export async function saveExtension(
  session: KdSession,
  req: SaveExtensionRequest,
): Promise<SaveExtensionResult> {
  const ap0 = encodeApField(JSON.parse(buildAp0Plain(req)));
  const res = await callKdsvc(session, METADATA_SERVICE, 'SaveForIDEV9', {
    apFields: { ap0 },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  // callKdsvc throws BosResponseError on `response_error:` envelopes, so
  // by here we know the body is meant to be JSON IDEOperateResult shape.
  const parsed = parseJsonResponse<{
    IsSuccess: boolean;
    FuncResult: boolean;
    MessageTitle: string | null;
    MessageDetail: string | null;
  }>(res.bodyText);
  return {
    isSuccess: parsed.IsSuccess,
    funcResult: parsed.FuncResult,
    messageTitle: parsed.MessageTitle,
    messageDetail: parsed.MessageDetail,
  };
}

/**
 * Metadata required to push a raw, pre-built FKERNELXML for an existing
 * extension via SaveForIDEV9. Mirrors the subset of `SaveExtensionRequest`
 * the server cares about for an `__paras__` ISV-descriptor envelope, sans
 * the typed AST (the caller already has `__source__`).
 *
 * Used by `saveExtensionRaw` — the raw-source twin of `saveExtension`.
 */
export interface SaveExtensionRawMeta {
  extId: string;
  /** Defaults to `extId` (the BOS Designer "save existing extension" pattern). */
  oldId?: string | null;
  /** Display name in zh-CN. Server enforces non-empty. */
  extName: string;
  modelTypeId: number;
  baseObjectId: string;
  /** Subsystem id, e.g. "23". */
  subSystemId: string;
  isv: IsvDescriptor;
}

/**
 * Build the `__paras__` JSON-string for `saveExtensionRaw`. Mirrors
 * `buildParas` for typed-AST callers but takes the raw fields directly so
 * we don't have to fabricate a `BosExtensionMeta` just to ship a string
 * source. Used by Plan 5.12.3b business-rule overlays — see
 * `business-rule-overlay.ts` for the wire shape rationale.
 */
export function buildRawParas(meta: SaveExtensionRawMeta): string {
  const oldId = meta.oldId !== undefined ? meta.oldId : meta.extId;
  return JSON.stringify({
    Id: meta.extId,
    OldId: oldId,
    ModelTypeId: meta.modelTypeId,
    BaseObjectId: meta.baseObjectId,
    DevType: 2,
    SubSystemId: meta.subSystemId,
    Version: null,
    PackageId: null,
    HasExtends: false,
    RunTime: false,
    LayoutViewId: null,
    OldLayoutViewId: null,
    LayoutViewVersion: null,
    DependencyObjectId: null,
    FirstNonExtendObjectID: meta.baseObjectId,
    ISV: meta.isv,
    UpdateIdToKey: false,
    SourceFormId: null,
    InheritPath: null,
    IsInheritElement: false,
    ModelTypeSubId: meta.modelTypeId,
    MainVersion: null,
    Name: JSON.stringify([{ Key: ZH_CN_LCID, Value: meta.extName }]),
    FuncInterfaces: null,
  });
}

/**
 * Push a raw, pre-built FKERNELXML source string to SaveForIDEV9. The
 * `sourceXml` param is the application-layer `__source__` value — the
 * caller is responsible for building it (typically by overlaying a delta
 * onto the extension's existing FKERNELXML).
 *
 * Returns the same typed result shape as `saveExtension`. Mirrors the
 * spike's `saveForIdeV9Direct` (see
 * `.scratch/probes/spike-bizrule-writeback.ts`) and is the sibling of
 * the typed-AST path used for fields / entries / plugins.
 */
export async function saveExtensionRaw(
  session: KdSession,
  meta: SaveExtensionRawMeta,
  sourceXml: string,
): Promise<SaveExtensionResult> {
  const ap0Plain = JSON.stringify({
    __source__: sourceXml,
    __paras__: buildRawParas(meta),
    [String(ZH_CN_LCID)]: '',
  });
  const ap0 = encodeApField(JSON.parse(ap0Plain));
  const res = await callKdsvc(session, METADATA_SERVICE, 'SaveForIDEV9', { apFields: { ap0 } });
  applySetCookieToSession(session, res.setCookieHeaders);
  const parsed = parseJsonResponse<{
    IsSuccess: boolean;
    FuncResult: boolean;
    MessageTitle: string | null;
    MessageDetail: string | null;
  }>(res.bodyText);
  return {
    isSuccess: parsed.IsSuccess,
    funcResult: parsed.FuncResult,
    messageTitle: parsed.MessageTitle,
    messageDetail: parsed.MessageDetail,
  };
}
