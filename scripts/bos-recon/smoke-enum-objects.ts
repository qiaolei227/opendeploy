/**
 * Smoke: enum-related RPCs surfaced in MetadataServiceV9Proxy.
 *
 * Decompile reference (Kingdee.BOS.ServiceFacade.KDServiceClient.dll):
 *   List<DynamicObject> GetEnumObjectList()
 *   DynamicObject[] LoadEnumObjectsV9(string text)
 *   DynamicObject LoadEnumObjectV9(string pk)
 *   List<Dictionary<string,string>> GetEnumData(fid, enumType, enumTypeL,
 *                                                enumItem, enumItemL)
 *   bool IsPresetEnumType(string enumid)
 *
 * Goal: determine what's the easiest "list all registered enum types + items"
 * call so kingdee_add_fields can support combo type referencing existing enums.
 */
import {
  callKdsvc,
  encodeApField,
  encodeApFieldRaw,
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
console.log('login ok:', loginRes.isSuccess);
if (!loginRes.isSuccess) process.exit(1);
const session = loginRes.session;

const SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';

interface Probe { name: string; method: string; apFields: Record<string, string>; }

const probes: Probe[] = [
  { name: 'GetEnumObjectList (no args)', method: 'GetEnumObjectList', apFields: {} },
  { name: 'LoadEnumObjectsV9("")', method: 'LoadEnumObjectsV9', apFields: { ap0: encodeApFieldRaw('') } },
  { name: 'LoadEnumObjectsV9("审核")', method: 'LoadEnumObjectsV9', apFields: { ap0: encodeApFieldRaw('审核') } },
  { name: 'LoadEnumObjectsV9 JSON-encoded ""', method: 'LoadEnumObjectsV9', apFields: { ap0: encodeApField('') } },
];

for (const p of probes) {
  console.log();
  console.log('===', p.name, '===');
  try {
    const r = await callKdsvc(session, SVC, p.method, { apFields: p.apFields });
    applySetCookieToSession(session, r.setCookieHeaders);
    console.log('  body len:', r.bodyText.length);
    if (r.bodyText.length === 0) {
      console.log('  empty');
      continue;
    }
    if (r.bodyText.length > 800) {
      console.log('  head:', r.bodyText.slice(0, 600).replace(/\n/g, ' '));
    } else {
      console.log('  body:', r.bodyText);
    }
    // Try parse + count + sample
    try {
      const parsed = parseJsonResponse(r.bodyText) as unknown;
      if (Array.isArray(parsed)) {
        console.log('  → array length:', parsed.length);
        if (parsed.length > 0) {
          const sample = parsed[0] as Record<string, unknown>;
          console.log('  → sample keys:', Object.keys(sample).slice(0, 30).join(', '));
          if (sample.FName || sample.Name || sample.Id || sample.FID) {
            console.log('  → sample id/name:',
              sample.Id ?? sample.FID,
              '/',
              JSON.stringify(sample.Name ?? sample.FName).slice(0, 80));
          }
        }
        // Drop dump
        const fs = await import('node:fs');
        const path = await import('node:path');
        const outDir = path.join('.scratch', 'enum-objects');
        fs.mkdirSync(outDir, { recursive: true });
        const fileName = p.name.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);
        fs.writeFileSync(path.join(outDir, `${fileName}.json`), JSON.stringify(parsed, null, 2));
        console.log(`  → wrote .scratch/enum-objects/${fileName}.json`);
      } else if (typeof parsed === 'object' && parsed !== null) {
        console.log('  → object keys:', Object.keys(parsed as object).slice(0, 30).join(', '));
      }
    } catch (perr) {
      console.log('  → parse threw:', String(perr).slice(0, 200));
    }
  } catch (err) {
    console.log('  threw:', String(err).slice(0, 300));
  }
}
