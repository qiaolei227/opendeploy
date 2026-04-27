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

const METADATA_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

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
