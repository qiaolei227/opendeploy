/**
 * Build ONE convert-rule extension and KEEP it — so user can open
 * BOS Designer and check whether it appears as a child of the standard
 * "销售订单至销售出库单" rule (correct) or as a sibling at the top level
 * (the bug we're tracking).
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

console.log('connected to', project.bos!.baseUrl, 'devCode=', project.bos!.devCode);
const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '');
const displayName = `OD验证-${stamp}`;
console.log(`\n建立转换规则扩展(SaleOrder-OutStock,显示名:${displayName})…`);
const r = await c.extendConvertRule('SaleOrder-OutStock', displayName);
if (!r.ok) { console.error('FAILED:', r.raw); process.exit(1); }
console.log('\n✅ 扩展已建,extId =', r.newExtensionId);
console.log('\n下一步:');
console.log('  1. 打开 BOS Designer (建议关闭客户端重登,清缓存)');
console.log('  2. 找到"销售订单 → 销售出库单"这条转换规则');
console.log('  3. 看"lineage 验证测试"扩展:');
console.log('     - 如果在标准规则**下面作为子节点** → ✅ ISV 修复有效');
console.log('     - 如果跟标准规则**平级** → ❌ 还有别的问题');
console.log('\n清理:');
console.log(`  pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/cleanup-test-extensions.ts ${r.newExtensionId}`);
process.exit(0);
