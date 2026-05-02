/**
 * R2 step 2 — add the full set of PAIJ custom field mappings to the empty
 * extension. 7 head-level + 4 entry-level. Skip BasePropertyField (TestCustName)
 * because it has no DynamicProperty and would NRE on push for unrelated reasons.
 *
 * If push works after this → DevType=0 was the actual root cause of yesterday's
 * NRE; convert rule extension feature is fully usable.
 * If push NREs → bisect within these 11 to find which type/entity is the trigger.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { setActiveProject, setBundledConvertRuleBaselines, getActiveConnector } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import type { Project } from '@shared/erp-types';

const extId = process.argv[2];
if (!extId) { console.error('usage: <script> <extId>'); process.exit(1); }

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
setBundledConvertRuleBaselines({
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({
    originXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'), 'utf-8'),
    extensionTemplateXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'), 'utf-8'),
  }),
});
await setActiveProject(project);
const c = getActiveConnector()!;

// targetEntryKey is the OutStock-side entry name (where data lands).
const TARGET_ENTRY = 'F_PAIJ_Entity_jo3';

const mappings: Array<[target: string, source: string, mode: string, entryKey?: string]> = [
  ['F_PAIJ_TestText',    'F_PAIJ_TestText',    'Auto'],
  ['F_PAIJ_TestInt',     'F_PAIJ_TestInt',     'Auto'],
  ['F_PAIJ_TestDecimal', 'F_PAIJ_TestDecimal', 'Auto'],
  ['F_PAIJ_TestDate',    'F_PAIJ_TestDate',    'Auto'],
  ['F_PAIJ_TestCheck',   'F_PAIJ_TestCheck',   'Auto'],
  ['F_PAIJ_TestCombo',   'F_PAIJ_TestCombo',   'Auto'],
  ['F_PAIJ_TestCust',    'F_PAIJ_TestCust',    'Auto'],
  ['F_PAIJ_TestUnit',    'F_PAIJ_TestUnit',    'Auto', TARGET_ENTRY],
  ['F_PAIJ_TestQty',     'F_PAIJ_TestQty',     'Auto', TARGET_ENTRY],
  ['F_PAIJ_TestPrice',   'F_PAIJ_TestPrice',   'Auto', TARGET_ENTRY],
  ['F_PAIJ_TestAmount',  'F_PAIJ_TestAmount',  'Auto', TARGET_ENTRY],
];

console.log(`adding ${mappings.length} mappings to extension ${extId}…`);
for (const [target, source, mode, entry] of mappings) {
  const r = await c.addConvertFieldMapping(extId, target, source, mode, undefined, entry);
  const tag = entry ? `entry=${entry}` : 'HEAD';
  console.log(`  ${r.ok ? '✓' : '✗'} ${target} ← ${source} (${mode}, ${tag})${r.ok ? '' : ' :: ' + r.raw.slice(0, 200)}`);
  if (!r.ok) process.exit(1);
}
console.log('\n✓ all mappings saved. Restart K/3 client and test push.');
process.exit(0);
