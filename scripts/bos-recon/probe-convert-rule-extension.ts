/**
 * Probe: pull a ConvertRule extension by GUID to learn its shape (delta or
 * full override?). Triggered by Plan 5.12.4 finding — `SaleOrder-OutStock`
 * had `HasExtends: true` and `InheritPathDescription` listed a GUID
 * `fe6154fe-7144-4633-97e9-601f65135ae9` for the extension rule; we want
 * to confirm whether `GetConvertRule(<guid>)` works for that.
 */
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { getConvertRule } from '../../src/main/erp/k3cloud/rpc/convert-rules';
import * as fs from 'node:fs';

const guid = process.argv[2] ?? 'fe6154fe-7144-4633-97e9-601f65135ae9';

const c = new K3CloudConnector({
  baseUrl: 'http://localhost/k3cloud',
  acctId: '69a531ee82525a',
  username: 'demo',
  password: '1qaz@WSX',
  devCode: 'PAIJ',
});
await c.connect();
const session = (c as unknown as { session: import('../../src/main/erp/k3cloud/rpc/http-client').KdSession }).session;

console.log('=== GetConvertRule(' + guid + ') ===');
try {
  const raw = await getConvertRule(session, guid);
  console.log('  ok, body length:', JSON.stringify(raw).length);
  console.log('  Top-level keys :', Object.keys(raw).slice(0, 30).join(', '));
  console.log('  Id             :', raw.Id);
  console.log('  Name           :', JSON.stringify(raw.Name));
  console.log('  HasExtends     :', (raw as Record<string, unknown>).HasExtends);
  console.log('  IsInheritElement:', (raw as Record<string, unknown>).IsInheritElement);
  console.log('  IsKingdeeElement:', (raw as Record<string, unknown>).IsKingdeeElement);
  console.log('  InheritPath    :', JSON.stringify((raw as Record<string, unknown>).InheritPath));
  console.log('  InheritPathDescription :',
    JSON.stringify((raw as Record<string, unknown>).InheritPathDescription).slice(0, 300));
  console.log('  FirstNonExtendObjectID :',
    (raw as Record<string, unknown>).FirstNonExtendObjectID);
  console.log('  ISV            :', JSON.stringify((raw as Record<string, unknown>).ISV));
  console.log();
  console.log('  Rule.IsInheritElement:', raw.Rule.IsInheritElement);
  console.log('  Rule.IsKingdeeElement:', raw.Rule.IsKingdeeElement);
  console.log('  Rule.SourceFormId :', raw.Rule.SourceFormId);
  console.log('  Rule.TargetFormId :', raw.Rule.TargetFormId);
  console.log();
  console.log('  Policies (' + raw.Rule.Policies.length + '):');
  raw.Rule.Policies.forEach((p, i) => {
    const cls = ((p.___InstClassType__ as string) || '').split(',')[0].split('.').pop();
    const inherit = p.IsInheritElement ? 'inherit' : 'NEW   ';
    const kingdee = p.IsKingdeeElement ? 'kingdee' : 'CUSTOM ';
    console.log(`    [${i}] ${(cls ?? '').padEnd(35)} ${inherit} ${kingdee}`);

    // Default Convert: dig into FieldMaps inheritance breakdown
    if (cls === 'DefaultConvertPolicyElement') {
      const fms = (p as { FieldMaps?: Array<Record<string, unknown>> }).FieldMaps ?? [];
      const stats: Record<string, number> = {};
      const customMaps: Array<{ target: string; mode: number; inherit: boolean }> = [];
      fms.forEach((f) => {
        const k = `${f.IsKingdeeElement ? 'kingdee' : 'CUSTOM'}+${f.IsInheritElement ? 'inherit' : 'NEW'}`;
        stats[k] = (stats[k] || 0) + 1;
        if (!f.IsKingdeeElement) {
          customMaps.push({
            target: f.TargetFieldKey as string,
            mode: f.ValueConvertMode as number,
            inherit: f.IsInheritElement as boolean,
          });
        }
      });
      console.log('         FieldMaps total:', fms.length, ', breakdown:', stats);
      if (customMaps.length > 0) {
        console.log('         CUSTOM maps:');
        customMaps.slice(0, 10).forEach((m) =>
          console.log(`           ${m.target} mode=${m.mode} inherit=${m.inherit}`),
        );
      }
    }
  });

  fs.mkdirSync('.scratch/convert-rule-recon', { recursive: true });
  const outPath = `.scratch/convert-rule-recon/extension-${guid}.json`;
  fs.writeFileSync(outPath, JSON.stringify(raw, null, 2));
  console.log('\n  saved →', outPath);
} catch (err) {
  console.log('  err:', err instanceof Error ? err.message : String(err));
}
