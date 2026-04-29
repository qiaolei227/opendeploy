import { callKdsvc, applySetCookieToSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const r = await login({
  baseUrl: 'http://localhost/k3cloud',
  acctId: '69a531ee82525a',
  username: 'demo',
  password: '1qaz@WSX',
});

const res = await callKdsvc(
  r.session,
  'Kingdee.BOS.ServiceFacade.ServicesStub.DataCenterService',
  'GetCurrentISV',
  { apFields: {} },
);
applySetCookieToSession(r.session, res.setCookieHeaders);
console.log('=== GetCurrentISV response ===');
console.log('len:', res.bodyText.length);
console.log('body:', res.bodyText);
console.log();
const parsed = JSON.parse(res.bodyText);
console.log('parsed.Id      :', parsed.Id);
console.log('parsed.Name    :', parsed.Name);
console.log('parsed.DevCode :', parsed.DevCode);
console.log('parsed.ISVSignal:', parsed.ISVSignal);
