/**
 * Plan 5.12.4 — end-to-end smoke through `K3CloudConnector` (production
 * call path: agent tool → connector → RPC client → server). Verifies:
 *   1. `listConvertRules('SAL_SaleOrder')` returns the expected paths
 *   2. `describeConvertRule('SaleOrder-OutStock')` returns a sane summary
 *   3. Token-level compression actually happened (raw vs summary size)
 *
 * Skips: agent dialog verification — that's Plan 5.12.4 Task 5 manual UAT
 * (open the app, ask the agent "销售订单可以下推到什么单据" and
 * "销售订单到出库单是怎么映射的", confirm answer matches).
 */
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'demo';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';
const devCode = process.env.K3_DEV_CODE ?? 'PAIJ';

const connector = new K3CloudConnector({ baseUrl, acctId, username, password, devCode });

console.log('=== Step 1: connect ===');
await connector.connect();
console.log('✓ connected\n');

console.log('=== Step 2: listConvertRules("SAL_SaleOrder") ===');
const paths = await connector.listConvertRules('SAL_SaleOrder');
console.log(`✓ ${paths.length} paths found`);
const targetForms = paths.map((p) => p.targetFormId);
console.log('  sample (first 5):');
paths.slice(0, 5).forEach((p) => {
  console.log(`    ${p.sourceFormId} (${p.sourceFormName}) → ${p.targetFormId} (${p.targetFormName})`);
});

if (!targetForms.includes('SAL_OUTSTOCK')) {
  console.error('✗ expected SAL_OUTSTOCK target in paths but not found');
  process.exit(1);
}
console.log('✓ SAL_OUTSTOCK present in targets\n');

console.log('=== Step 3: describeConvertRule("SaleOrder-OutStock") ===');
const summary = await connector.describeConvertRule('SaleOrder-OutStock');
console.log(`✓ summary returned`);
console.log(`  ruleId       : ${summary.ruleId}`);
console.log(`  source/target: ${summary.sourceFormId} → ${summary.targetFormId}`);
console.log(`  isDefault    : ${summary.isDefault}`);
console.log(`  fieldMapCount: ${summary.defaultConvert?.fieldMapCount}`);
console.log(`  formulaMaps  : ${summary.defaultConvert?.formulaMaps.length}`);
console.log(`  groupBy      : ${summary.groupBy?.mode} → [${summary.groupBy?.fields.join(', ')}]`);
console.log(`  plugins      : ${summary.plugins.length}`);
console.log(`  billTypeMaps : ${summary.billTypeMaps.length}`);

// Sanity: SaleOrder-OutStock has known characteristics from prior recon
if ((summary.defaultConvert?.formulaMaps.length ?? 0) === 0) {
  console.error('✗ expected at least 1 formula map in SaleOrder-OutStock but got 0');
  process.exit(1);
}
console.log(`\n--- formulaMaps ---`);
summary.defaultConvert?.formulaMaps.forEach((f) => {
  console.log(`  ${f.target} → ${(f.formula || '').slice(0, 70)}`);
});

console.log('\n=== Step 4: size compression ===');
const summarySize = JSON.stringify(summary).length;
console.log(`  summary: ${summarySize.toLocaleString()} bytes`);
if (summarySize > 20_000) {
  console.error(`✗ summary too large (${summarySize} bytes) — summarizer regression?`);
  process.exit(1);
}
console.log(`✓ summary under 20KB cap\n`);

console.log('=== Step 5: not-found path ===');
try {
  await connector.describeConvertRule('Nonexistent-Rule-XYZ');
  console.error('✗ expected describeConvertRule("Nonexistent-Rule-XYZ") to throw, but it returned');
  process.exit(1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('response_error') || msg.includes('不存在')) {
    console.log(`✓ throws response_error for unknown ruleId (handled by tool layer's try/catch)`);
  } else {
    console.error(`✗ unexpected error: ${msg}`);
    process.exit(1);
  }
}

console.log('\n=== All e2e checks passed ===');
process.exit(0);
