/**
 * R1 hiccup probe — list convert paths from SAL_SaleOrder. We just created an
 * empty extension on SaleOrder-OutStock; user reports the push menu in the
 * fat client now lacks 销售出库单. Check server-side discovery first.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { setActiveProject, setBundledConvertRuleBaselines, getActiveConnector } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import type { Project } from '@shared/erp-types';

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

const paths = await c.listConvertRules('SAL_SaleOrder');
console.log(`\n${paths.length} paths from SAL_SaleOrder:`);
for (const p of paths) {
  const mark = p.targetFormId === 'SAL_OUTSTOCK' ? ' ⬅️' : '';
  console.log(`  ${p.ruleId}: ${p.sourceFormId} → ${p.targetFormId} (${p.targetFormName})${mark}`);
}

const outStock = paths.filter((p) => p.targetFormId === 'SAL_OUTSTOCK');
console.log(`\n销售出库单 paths: ${outStock.length}`);
if (outStock.length === 0) {
  console.log('❌ 服务端列表里都没有 SAL_OUTSTOCK — 扩展破坏了规则发现');
} else {
  console.log('✅ 服务端列表里 SAL_OUTSTOCK 还在 — 是客户端 cache / 单据状态问题');
}
process.exit(0);
