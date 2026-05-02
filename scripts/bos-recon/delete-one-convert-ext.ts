/**
 * One-off: delete a single convert-rule extension by extId, given as arg.
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
const r = await c.deleteConvertRuleExtension('SaleOrder-OutStock', extId);
console.log(r.ok ? `✓ deleted ${extId}` : `✗ ${r.raw.slice(0, 300)}`);
process.exit(r.ok ? 0 : 1);
