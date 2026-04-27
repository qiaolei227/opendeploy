/**
 * Delete a BOS extension via RPC.
 *
 * Mirrors `MetadataServiceV9Proxy.Delete(string id, ISV currentIsv)` in
 * Kingdee.BOS.ServiceFacade.KDServiceClient.dll line 4027:
 *
 *   ExecuteService<object>("Delete", new object[2] { id, currentIsv });
 *
 * Endpoint: `{baseUrl}/Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService.Delete.common.kdsvc`
 *
 * Payload args:
 *   ap0 = id  — the extension FID (32-char hex GUID)
 *   ap1 = ISV — the developer identity that owns the extension
 *
 * Server returns void (null/object). HTTP 200 + non-error response means
 * the extension row was deleted (T_META_OBJECTTYPE + cascade tables).
 *
 * Caveat: BOS Designer's own delete path also touches SVN local working
 * copy (memory `bos_designer_svn_kills_delete.md` documents the pain).
 * The pure RPC delete avoids SVN entirely — it just tells the server to
 * drop the row. Local SVN .dym files (if any) become orphaned but harmless
 * (runtime reads from DB, not files). For team SVN setups, user must do
 * `svn revert <FID>.dym` or manually remove the dym file post-delete.
 */

import { KdSession, callKdsvc, encodeApField, encodeApFieldRaw, applySetCookieToSession } from './http-client';
import type { BosIsvIdentity } from './types';

const METADATA_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

export interface DeleteExtensionResult {
  ok: boolean;
  /** Server's raw response body for diagnostics. Empty/null on success. */
  responseBody: string;
  /** Set when ok=false. */
  message?: string;
}

export async function deleteExtension(
  session: KdSession,
  formId: string,
  isv: BosIsvIdentity,
): Promise<DeleteExtensionResult> {
  const isvPayload = {
    Id: isv.id ?? isv.devCode,
    Name: isv.name ?? isv.devCode,
    ISVSignal: isv.isvSignal ?? 'Kingdee',
    PackageSignal: isv.packageSignal ?? '',
    DevCode: isv.devCode,
  };
  const res = await callKdsvc(session, METADATA_SERVICE, 'Delete', {
    apFields: { ap0: encodeApFieldRaw(formId), ap1: encodeApField(isvPayload) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  // void return — body is "null" string or empty. Anything else is suspicious.
  const text = res.bodyText.trim();
  if (text === '' || text === 'null') {
    return { ok: true, responseBody: text };
  }
  // Some error envelopes come back as JSON {Message, MessageCode}. Try to parse.
  try {
    const parsed = JSON.parse(text) as { Message?: string };
    return { ok: false, responseBody: text, message: parsed.Message ?? text };
  } catch {
    return { ok: false, responseBody: text, message: text };
  }
}
