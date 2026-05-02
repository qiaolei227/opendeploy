/**
 * R2 step 1 — add ONE simple field mapping (FNote → FNote, head-level, Auto)
 * to the existing empty extension. Then user reloads K/3 client and tests
 * push. If push NREs → fieldmap path is the culprit. If push works →
 * proceed to step 2 (add plugin).
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

console.log(`adding FNote → FNote (Auto, head-level) to extension ${extId}…`);
const r = await c.addConvertFieldMapping(extId, 'FNote', 'FNote', 'Auto');
console.log(r.ok ? '✓ saved' : `✗ ${r.raw.slice(0, 300)}`);
process.exit(r.ok ? 0 : 1);
