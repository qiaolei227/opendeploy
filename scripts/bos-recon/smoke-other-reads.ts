/**
 * Smoke: probe whether the supplementary read RPCs return JSON or
 * BinaryFormatter. We need GetSubSystems, QueryObjectType, GetObjectTypes
 * to round out the 9-tool migration.
 */
import { callKdsvc, encodeApField, encodeApFieldRaw, applySetCookieToSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'demo';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';

const META = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

const loginRes = await login({ baseUrl, acctId, username, password });
if (!loginRes.isSuccess) { console.error('login failed:', loginRes.message); process.exit(1); }
const session = loginRes.session;
console.log('logged in:', loginRes.userId);
console.log();

async function probe(name: string, method: string, fields: Record<string, string>) {
  console.log('=== ', method, '===');
  try {
    const r = await callKdsvc(session, META, method, { apFields: fields });
    applySetCookieToSession(session, r.setCookieHeaders);
    console.log('  ok body length:', r.bodyText.length);
    console.log('  head 250:', r.bodyText.slice(0, 250).replace(/\n/g, ' '));
  } catch (e) {
    console.log('  threw:', (e as Error).message.slice(0, 80));
  }
  console.log();
}

await probe('GetSubSystems', 'GetSubSystems', {});
await probe('QueryObjectType', 'QueryObjectType', { ap0: encodeApFieldRaw('信用') });
await probe('GetObjectTypes (subsystem 23 / SAL)', 'GetObjectTypes', {
  ap0: encodeApField(['23']),  // subsystemIDs
});
await probe('GetTopClasses', 'GetTopClasses', {});
await probe('HeartBeat', 'HeartBeat', {});
