/**
 * `DataCenterService.GetCurrentISV` — returns the active ISV (开发商)
 * descriptor. Used by Plan 5.12.4 v2 to populate `__isv__` on
 * `SaveRulesV9` calls without forcing the user to enter their BOS Designer
 * activation key manually.
 *
 * Service path quirk: this endpoint sits at
 *   `Kingdee.BOS.ServiceFacade.ServicesStub.DataCenterService.GetCurrentISV`
 * — directly under `ServicesStub`, **without** the `DataCenter.` namespace
 * prefix that most metadata endpoints use (`Metadata.MetadataService` etc.).
 *
 * Wire format (verified 2026-04-30 against demo data center):
 *   - request: zero ap fields
 *   - response: bare JSON `{Id, Name, ISVSignal, PackageSignal, DevCode}`
 *
 * The `Id` field is a 5×4 alphanumeric string (e.g. `IBHC-LMFG-QIMZ-LHQA-VFBK`)
 * — looks like an activation key issued at BOS Designer install time. It's
 * the value `SaveRulesV9` requires inside `__paras__.ISV.Id` and `__isv__.Id`.
 */

import {
  callKdsvc,
  applySetCookieToSession,
  parseJsonResponse,
  type KdSession,
} from './http-client';
import type { IsvDescriptor } from './save-convert-rules';

const DATA_CENTER_SERVICE = 'Kingdee.BOS.ServiceFacade.ServicesStub.DataCenterService';

export async function getCurrentIsv(session: KdSession): Promise<IsvDescriptor> {
  const res = await callKdsvc(session, DATA_CENTER_SERVICE, 'GetCurrentISV', {
    apFields: {},
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  if (!res.bodyText) {
    throw new Error('GetCurrentISV: empty response from server');
  }
  return parseJsonResponse<IsvDescriptor>(res.bodyText);
}
