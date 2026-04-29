import { callKdsvc, encodeApFieldRaw, applySetCookieToSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const r = await login({
  baseUrl: 'http://localhost/k3cloud',
  acctId: '69a531ee82525a',
  username: 'demo',
  password: '1qaz@WSX',
});
const session = r.session;
const SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService';
const guid = 'fe6154fe-7144-4633-97e9-601f65135ae9';

const variants = [
  { method: 'GetConvertRuleByRunTime', name: '(guid, false)', apFields: { ap0: encodeApFieldRaw(guid), ap1: encodeApFieldRaw('false') } },
  { method: 'GetConvertRuleByRunTime', name: '(guid, true)',  apFields: { ap0: encodeApFieldRaw(guid), ap1: encodeApFieldRaw('true')  } },
  { method: 'GetConvertRuleByRunTime', name: '(SaleOrder-OutStock, false)', apFields: { ap0: encodeApFieldRaw('SaleOrder-OutStock'), ap1: encodeApFieldRaw('false') } },
  { method: 'IsExistConvertRuleID',    name: '(guid)', apFields: { ap0: encodeApFieldRaw(guid) } },
  { method: 'IsConvertRuleExist',      name: '(guid)', apFields: { ap0: encodeApFieldRaw(guid) } },
];

for (const v of variants) {
  console.log('\n--- ' + v.method + v.name + ' ---');
  try {
    const res = await callKdsvc(session, SVC, v.method, { apFields: v.apFields });
    applySetCookieToSession(session, res.setCookieHeaders);
    console.log('  body len:', res.bodyText.length);
    const head = res.bodyText.slice(0, 300).replace(/\n/g, ' ');
    console.log('  head:', head);
    if (res.bodyText.startsWith('{') || res.bodyText.startsWith('[')) {
      console.log('  → JSON ✅');
      const fs = await import('node:fs');
      fs.mkdirSync('.scratch/convert-rule-recon', { recursive: true });
      const safe = `${v.method}__${v.name.replace(/[^a-z0-9]/gi, '_')}`;
      fs.writeFileSync(`.scratch/convert-rule-recon/${safe}.json`, res.bodyText);
    } else if (res.bodyText.includes('<KingdeeXMLPack')) {
      console.log('  → KingdeeXMLPack (BinaryFormatter) ❌');
    } else if (/^(true|false|\d+|"[^"]*")\s*$/.test(res.bodyText.trim())) {
      console.log('  → primitive JSON value');
    } else {
      console.log('  → unknown format');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('  failed:', msg.slice(0, 250).replace(/\n/g, ' '));
  }
}
