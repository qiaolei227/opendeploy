/**
 * Smoke: SQLScriptServiceV9Proxy.Execute / ExecuteSafe — sandboxed SQL
 * gateway. If this returns JSON we have a unified RPC channel for all
 * T_META_* reads (5.12.4 ConvertRule / 5.12.5 WriteBack / 5.12.6 Operation
 * + Plan 6 business-data consented reads).
 *
 * Decompile reference (Kingdee.BOS.ServiceFacade.KDServiceClient.dll line 4639+):
 *   class SQLScriptServiceV9Proxy : BaseServiceProxy
 *     public string Execute(string strSQL, List<SqlParam> paramList)
 *     public string ExecuteSafe(string strSQL, List<SqlParam> paramList,
 *                               IllegalSqlCheckType[] sqlcheckTypes)
 *     public DataSet ExecuteDataSet(string strSQL)
 *
 * Tests two methods × multiple arg shapes against a known-good metadata
 * SELECT (T_META_CONVERTRULE — read whitelist).
 */
import {
  callKdsvc,
  encodeApField,
  encodeApFieldRaw,
  applySetCookieToSession,
} from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'demo';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';

const SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.SQLScriptService';

const TEST_SQL = `SELECT TOP 3 cr.FID, cr.FSOURCEFORMID, cr.FTARGETFORMID, cr.FSTATUS, cr.FISDEFAULT, l.FNAME
FROM T_META_CONVERTRULE cr
LEFT JOIN T_META_CONVERTRULE_L l ON cr.FID = l.FID AND l.FLOCALEID = 2052
WHERE cr.FSOURCEFORMID = 'SAL_SaleOrder' AND cr.FSTATUS = '1'
ORDER BY cr.FISDEFAULT DESC, l.FNAME`;

console.log('=== Login ===');
const loginRes = await login({ baseUrl, acctId, username, password });
console.log('login ok:', loginRes.isSuccess, 'userId:', loginRes.userId);
if (!loginRes.isSuccess) {
  console.error('login failed:', loginRes.message);
  process.exit(1);
}
const session = loginRes.session;

interface Variant {
  name: string;
  method: 'Execute' | 'ExecuteSafe' | 'ExecuteDataSet';
  apFields: Record<string, string>;
}

const variants: Variant[] = [
  // Execute(strSQL, paramList) — paramList is List<SqlParam>
  { name: 'Execute(SQL, [])', method: 'Execute',
    apFields: { ap0: encodeApFieldRaw(TEST_SQL), ap1: encodeApField([]) } },
  { name: 'Execute(SQL, null)', method: 'Execute',
    apFields: { ap0: encodeApFieldRaw(TEST_SQL), ap1: encodeApField(null) } },

  // ExecuteSafe(strSQL, paramList, sqlcheckTypes)
  { name: 'ExecuteSafe(SQL, [], [])', method: 'ExecuteSafe',
    apFields: { ap0: encodeApFieldRaw(TEST_SQL), ap1: encodeApField([]), ap2: encodeApField([]) } },
  { name: 'ExecuteSafe(SQL, null, [])', method: 'ExecuteSafe',
    apFields: { ap0: encodeApFieldRaw(TEST_SQL), ap1: encodeApField(null), ap2: encodeApField([]) } },
  { name: 'ExecuteSafe(SQL, [], null)', method: 'ExecuteSafe',
    apFields: { ap0: encodeApFieldRaw(TEST_SQL), ap1: encodeApField([]), ap2: encodeApField(null) } },

  // ExecuteDataSet(strSQL) — likely DataSet (.NET BinaryFormatter), tested last
  { name: 'ExecuteDataSet(SQL)', method: 'ExecuteDataSet',
    apFields: { ap0: encodeApFieldRaw(TEST_SQL) } },
];

console.log();
console.log('=== Test SQL ===');
console.log(TEST_SQL);
console.log();

let foundJsonVariant: Variant | null = null;
let foundBody: string | null = null;

for (const v of variants) {
  console.log('--- variant:', v.name, '---');
  try {
    const r = await callKdsvc(session, SVC, v.method, { apFields: v.apFields });
    applySetCookieToSession(session, r.setCookieHeaders);
    console.log('  ok body len:', r.bodyText.length);
    const head = r.bodyText.slice(0, 400).replace(/\n/g, ' ');
    console.log('  head:', head);
    if (r.bodyText.startsWith('{') || r.bodyText.startsWith('[')) {
      console.log('  → looks like JSON ✅');
      if (!foundJsonVariant) {
        foundJsonVariant = v;
        foundBody = r.bodyText;
      }
    } else if (r.bodyText.includes('<KingdeeXMLPack')) {
      console.log('  → KingdeeXMLPack envelope (likely .NET BinaryFormatter, unusable) ❌');
    } else {
      console.log('  → unknown format');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('  failed:');
    console.log('   ', msg.replace(/\n/g, '\n    '));
  }
}

if (foundJsonVariant && foundBody) {
  console.log();
  console.log('=== Winner:', foundJsonVariant.name, '===');
  try {
    const parsed = JSON.parse(foundBody);
    console.log('parsed shape:', Array.isArray(parsed) ? `array(${parsed.length})` : typeof parsed);
    console.log('full body:');
    console.log(foundBody);
  } catch {
    console.log('JSON.parse threw — body is not parseable JSON');
    console.log('full body:');
    console.log(foundBody);
  }
}
