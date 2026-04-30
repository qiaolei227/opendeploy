/**
 * Cleanup leftover artifacts from simulate-full-agent-flow.ts when it
 * exits mid-flow. Deletes the convert-rule extension (B1) and the form
 * extension (A1) so the dev DB stays clean.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';

const FORM_EXT = process.argv[2];
const CONVERT_EXT = process.argv[3];
if (!FORM_EXT || !CONVERT_EXT) {
  console.error('usage: cleanup-simulate.ts <formExtId> <convertExtId>');
  process.exit(1);
}

const originXml = readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'), 'utf-8');
const extensionTemplateXml = readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'), 'utf-8');
const baselines = { 'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({ originXml, extensionTemplateXml }) };
const c = new K3CloudConnector(
  { baseUrl: 'http://localhost/k3cloud', acctId: '69a531ee82525a', username: 'demo', password: '1qaz@WSX', devCode: 'PAIJ' },
  baselines,
);
await c.connect();

console.log('Deleting convert-rule extension', CONVERT_EXT);
try {
  const r = await c.deleteConvertRuleExtension('SaleOrder-OutStock', CONVERT_EXT);
  console.log('  result:', r.ok ? 'OK' : `FAIL: ${r.raw.slice(0, 200)}`);
} catch (e) {
  console.log('  threw:', e instanceof Error ? e.message.slice(0, 200) : e);
}
console.log('Form extension', FORM_EXT, 'left in DB — delete via BOS Designer manually');
process.exit(0);
