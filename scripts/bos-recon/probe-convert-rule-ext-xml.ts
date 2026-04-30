/**
 * Probe: can we retrieve a convert-rule extension's current XML?
 *
 * Tests two candidate paths for Task 3-4 (字段映射 patch flow):
 *   A) getConvertRule(extId)              — does it return the extension's
 *      own delta JSON (IsInheritElement=true, smaller payload)?
 *   B) getBusinessObjectMetaData(extId)  — does it work for convert-rule
 *      extensions (they may not be in T_META_OBJECTTYPE)?
 *
 * Prerequisites:
 *   - pnpm dev / k3cloud running at http://localhost/k3cloud
 *   - At least one SaleOrder-OutStock extension already created in the dev
 *     account, OR pass --create to create one first (then deletes it).
 *
 * Run:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/probe-convert-rule-ext-xml.ts
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/probe-convert-rule-ext-xml.ts --create
 */

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { setBundledConvertRuleBaselines } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import { getConvertRule } from '../../src/main/erp/k3cloud/rpc/convert-rules';
import { getBusinessObjectMetaData } from '../../src/main/erp/k3cloud/rpc/metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORIGIN_RULE_ID = 'SaleOrder-OutStock';
const CREATE_FLAG = process.argv.includes('--create');

// ── bootstrap baselines ───────────────────────────────────────────
const originXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'),
  'utf-8',
);
const extensionTemplateXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'),
  'utf-8',
);
setBundledConvertRuleBaselines({
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({ originXml, extensionTemplateXml }),
});

// ── connect ───────────────────────────────────────────────────────
const baselines = {
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({ originXml, extensionTemplateXml }),
};
const c = new K3CloudConnector(
  {
    baseUrl: 'http://localhost/k3cloud',
    acctId: '69a531ee82525a',
    username: 'demo',
    password: '1qaz@WSX',
  },
  baselines,
);
await c.connect();
const session = c.getSession()!;
console.log('connected\n');

// ── find or create an extension ───────────────────────────────────
let extId: string | null = null;
let createdByUs = false;

// First check if there's already an extension in the dev DB.
const desc = await c.describeConvertRule(ORIGIN_RULE_ID);
const lineage = (desc as { extension?: { lineage?: Array<{ id: string }> } }).extension?.lineage;
if (lineage && lineage.length > 1) {
  extId = lineage[lineage.length - 1].id;
  console.log(`found existing extension: ${extId}`);
} else if (CREATE_FLAG) {
  console.log('no extension found — creating one...');
  const result = await c.extendConvertRule(ORIGIN_RULE_ID, 'probe-ext-xml-test');
  if (!result.ok) throw new Error('extendConvertRule failed: ' + JSON.stringify(result));
  extId = result.newExtensionId;
  createdByUs = true;
  console.log(`created extension: ${extId}\n`);
} else {
  console.log('no extension found. Re-run with --create to create one first.');
  process.exit(1);
}

// ── path A: getConvertRule(extId) ─────────────────────────────────
console.log('═══ Path A: getConvertRule(extId) ═══');
const originRaw = await getConvertRule(session, ORIGIN_RULE_ID);
const originJson = JSON.stringify(originRaw);
console.log(`  origin (${ORIGIN_RULE_ID}): ${originJson.length} chars`);
console.log(`    IsInheritElement: ${originRaw.IsInheritElement}`);
console.log(`    HasExtends: ${originRaw.HasExtends}`);
console.log(`    Policies: ${originRaw.Rule?.Policies?.length}`);

const extRaw = await getConvertRule(session, extId!);
const extJson = JSON.stringify(extRaw);
console.log(`\n  extension (${extId}): ${extJson.length} chars`);
console.log(`    IsInheritElement: ${extRaw.IsInheritElement}`);
console.log(`    HasExtends: ${extRaw.HasExtends}`);
console.log(`    Policies: ${extRaw.Rule?.Policies?.length}`);
console.log(`    ISV.Name: ${extRaw.ISV?.Name}`);

const isDelta = extJson.length < originJson.length * 0.8;
console.log(`\n  verdict: ${isDelta ? '✅ extension looks like a delta (smaller payload)' : '⚠️  similar size to origin — may be merged runtime view'}`);

// ── path B: getBusinessObjectMetaData(extId) ─────────────────────
console.log('\n═══ Path B: getBusinessObjectMetaData(extId) ═══');
try {
  const meta = await getBusinessObjectMetaData(session, extId!);
  if (meta.metaData && meta.metaData.length > 0) {
    console.log(`  ✅ returned FKERNELXML (${meta.metaData.length} chars)`);
    console.log('  first 300 chars:', meta.metaData.slice(0, 300));
  } else {
    console.log('  ⚠️  returned empty metaData — convert-rule extensions may not be in T_META_OBJECTTYPE');
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log('  ❌ threw:', msg.slice(0, 300));
}

// ── cleanup ───────────────────────────────────────────────────────
if (createdByUs) {
  console.log('\n── cleaning up created extension...');
  const del = await c.deleteConvertRuleExtension(ORIGIN_RULE_ID, extId!);
  console.log('  deleted:', del.ok);
}

await c.disconnect();
console.log('\ndone.');
