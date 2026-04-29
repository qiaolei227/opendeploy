/**
 * Smoke: MetadataService.GetConvertRule / GetConvertRules — POCO endpoints
 * returning ConvertRuleElement (not the DynamicObject-wrapped MetaData).
 * If these return JSON we've got the missing piece for Plan 5.12.4.
 *
 * Decompile reference (Kingdee.BOS.ServiceFacade.KDServiceClient.dll):
 *   class MetadataServiceV9Proxy line 3821, methods line 4138/4143:
 *     public ConvertRuleElement GetConvertRule(string Id)
 *     public List<ConvertRuleElement> GetConvertRules(string sourceFormID, string targetFormID)
 *   (Forwards to GetOldProxy() which calls ExecuteService<...> at line 6261-6268)
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

const META_SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';
const CONV_SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService';

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
  service: string;
  method: string;
  apFields: Record<string, string>;
}

const variants: Variant[] = [
  // POCO endpoints — should return JSON if DataContractSerializer
  { name: 'MetadataService.GetConvertRule(SaleOrder-OutStock)', service: META_SVC, method: 'GetConvertRule',
    apFields: { ap0: encodeApFieldRaw('SaleOrder-OutStock') } },
  { name: 'MetadataService.GetConvertRules(SAL_SaleOrder, SAL_OUTSTOCK)', service: META_SVC, method: 'GetConvertRules',
    apFields: { ap0: encodeApFieldRaw('SAL_SaleOrder'), ap1: encodeApFieldRaw('SAL_OUTSTOCK') } },

  // Try same names on ConvertService too — might be the actual stub home
  { name: 'ConvertService.GetConvertRule(SaleOrder-OutStock)', service: CONV_SVC, method: 'GetConvertRule',
    apFields: { ap0: encodeApFieldRaw('SaleOrder-OutStock') } },
  { name: 'ConvertService.GetConvertRules(SAL_SaleOrder, SAL_OUTSTOCK)', service: CONV_SVC, method: 'GetConvertRules',
    apFields: { ap0: encodeApFieldRaw('SAL_SaleOrder'), ap1: encodeApFieldRaw('SAL_OUTSTOCK') } },
];

for (const v of variants) {
  console.log('\n--- variant:', v.name, '---');
  try {
    const r = await callKdsvc(session, v.service, v.method, { apFields: v.apFields });
    applySetCookieToSession(session, r.setCookieHeaders);
    console.log('  ok body len:', r.bodyText.length);
    const head = r.bodyText.slice(0, 500).replace(/\n/g, ' ');
    console.log('  head:', head);
    if (r.bodyText.startsWith('{') || r.bodyText.startsWith('[')) {
      console.log('  → JSON ✅');
      // Save full body for analysis
      const fs = await import('node:fs');
      const path = await import('node:path');
      const safe = v.name.replace(/[^a-z0-9]/gi, '_');
      const outDir = path.join('.scratch', 'convert-rule-recon');
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${safe}.json`);
      fs.writeFileSync(outPath, r.bodyText);
      console.log(`  saved → ${outPath} (${r.bodyText.length} bytes)`);
      // Stat structure
      try {
        const parsed = JSON.parse(r.bodyText);
        if (Array.isArray(parsed)) {
          console.log(`  array(${parsed.length})`);
          if (parsed.length > 0) {
            console.log(`  [0] keys:`, Object.keys(parsed[0]).slice(0, 20).join(', '));
          }
        } else if (parsed && typeof parsed === 'object') {
          console.log(`  object keys:`, Object.keys(parsed).slice(0, 20).join(', '));
        }
      } catch {
        console.log('  (JSON.parse failed despite { or [ start)');
      }
    } else if (r.bodyText.includes('<KingdeeXMLPack')) {
      console.log('  → KingdeeXMLPack (BinaryFormatter, unusable) ❌');
    } else {
      console.log('  → unknown format');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('  failed:');
    console.log('   ', msg.slice(0, 400).replace(/\n/g, ' '));
  }
}
