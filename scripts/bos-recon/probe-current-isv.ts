/**
 * Probe: find the RPC that returns the ISV.Id we need for SaveRulesV9.
 * Plan 5.12.4 v2 — empirical IBHC-LMFG-QIMZ-LHQA-VFBK (UNW dev code's
 * registered ISV.Id) must come from somewhere; trying candidates that show
 * up in the proxy decompile.
 */
import { callKdsvc, applySetCookieToSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const r = await login({
  baseUrl: 'http://localhost/k3cloud',
  acctId: '69a531ee82525a',
  username: 'demo',
  password: '1qaz@WSX',
});
const session = r.session;

const candidates = [
  { svc: 'Kingdee.BOS.ServiceFacade.ServicesStub.DataCenter.DataCenterService', method: 'GetCurrentISV' },
  { svc: 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService', method: 'GetCurrentISV' },
  { svc: 'Kingdee.BOS.ServiceFacade.ServicesStub.AppDesigner.AppDesignerService', method: 'GetCurrentISV' },
  { svc: 'Kingdee.BOS.ServiceFacade.ServicesStub.AppDesigner.AppDesignerService', method: 'GetISVList' },
  { svc: 'Kingdee.BOS.ServiceFacade.ServicesStub.AppDesigner.AppDesignerService', method: 'GetInstalledPackage' },
  { svc: 'Kingdee.BOS.ServiceFacade.ServicesStub.AppDesigner.AppDesignerService', method: 'GetAllISV' },
  { svc: 'Kingdee.BOS.ServiceFacade.ServicesStub.AppDesigner.AppDesignerService', method: 'GetISVInfo' },
];

for (const c of candidates) {
  const tag = c.svc.split('.').slice(-1)[0] + '.' + c.method;
  console.log(`\n--- ${tag} ---`);
  try {
    const res = await callKdsvc(session, c.svc, c.method, { apFields: {} });
    applySetCookieToSession(session, res.setCookieHeaders);
    console.log('  body len:', res.bodyText.length);
    console.log('  head:', res.bodyText.slice(0, 800).replace(/\n/g, ' '));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('  failed:', msg.slice(0, 250).replace(/\n/g, ' '));
  }
}
