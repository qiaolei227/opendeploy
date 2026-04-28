/**
 * Smoke: GetLookupObjects on MetadataService — verify we can resolve a
 * basedata FormId (e.g. "BD_UnitGroup") to its T_META_LOOKUPCLASS GUID
 * (the value BOS expects in `<LookUpObjectID>` of BaseDataField / UnitField).
 *
 * Decompile reference: MetadataServiceV9Proxy.GetLookupObjects(LookUpObjectFilter)
 * → List<LookUpObject>. LookUpObject has Id (GUID), FormId (e.g. "BD_Customer"),
 * Name, TableName, PkFieldName, NumberFieldName, etc.
 *
 * LookUpObjectFilter: { IsAssistData: bool, Filter: string, BaseDataType: int }
 *   BaseDataType values: 1=Group, 500=Bill, 400=Base, 401=Assistant,
 *   402=ItemClass, 403=FlexValue, 800=Flex.
 */
import {
  callKdsvc,
  encodeApField,
  applySetCookieToSession,
  parseJsonResponse,
} from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'demo';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';

console.log('=== Login ===');
const loginRes = await login({ baseUrl, acctId, username, password });
console.log('login ok:', loginRes.isSuccess, 'userId:', loginRes.userId);
if (!loginRes.isSuccess) {
  console.error('login failed:', loginRes.message);
  process.exit(1);
}
const session = loginRes.session;

const SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

// Try a few filter shapes — server validates the JSON.
const variants: Array<{ name: string; filter: object }> = [
  { name: 'BaseDataType=400 (Base) no filter', filter: { IsAssistData: false, Filter: '', BaseDataType: 400 } },
  { name: 'BaseDataType=0 (all)', filter: { IsAssistData: false, Filter: '', BaseDataType: 0 } },
  { name: 'BaseDataType=400 + Filter="BD_UnitGroup"', filter: { IsAssistData: false, Filter: 'BD_UnitGroup', BaseDataType: 400 } },
];

for (const v of variants) {
  console.log();
  console.log('=== variant:', v.name, '===');
  try {
    const r = await callKdsvc(session, SVC, 'GetLookupObjects', {
      apFields: { ap0: encodeApField(v.filter) },
    });
    applySetCookieToSession(session, r.setCookieHeaders);
    console.log('  body len:', r.bodyText.length);
    if (r.bodyText.length === 0) {
      console.log('  empty');
      continue;
    }
    const arr = parseJsonResponse<Array<Record<string, unknown>>>(r.bodyText);
    console.log('  count:', Array.isArray(arr) ? arr.length : 'not array');
    if (Array.isArray(arr) && arr.length > 0) {
      const sample = arr[0];
      console.log('  sample keys:', Object.keys(sample).slice(0, 30).join(', '));
      console.log('  sample:', JSON.stringify(sample, null, 2).slice(0, 800));

      // Hunt for the ones we care about.
      const targets = ['BD_UnitGroup', 'BD_Customer', 'BD_MATERIAL', 'BD_Department'];
      for (const t of targets) {
        const hit = arr.find((o) => String((o as Record<string, unknown>).FormId ?? '') === t);
        if (hit) {
          console.log(`  → ${t}: Id=${hit['Id']}, TableName=${hit['TableName']}, PkFieldName=${hit['PkFieldName']}`);
        } else {
          console.log(`  → ${t}: NOT in result`);
        }
      }

      // Drop full result for offline inspection.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const outDir = path.join('.scratch', 'lookup-objects');
      fs.mkdirSync(outDir, { recursive: true });
      const fileName = v.name.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);
      fs.writeFileSync(path.join(outDir, `${fileName}.json`), JSON.stringify(arr, null, 2));
      console.log(`  wrote .scratch/lookup-objects/${fileName}.json`);
    }
  } catch (err) {
    console.log('  threw:', String(err).slice(0, 300));
  }
}
