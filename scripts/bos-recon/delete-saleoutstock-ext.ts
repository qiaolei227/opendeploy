import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { setActiveProject, setBundledConvertRuleBaselines, getActiveConnector } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { deleteExtension } from '../../src/main/erp/k3cloud/rpc/delete-extension';
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

const TARGET_EXT = '2367372bc52e42ad826b8b6eceb60744';
const loginResult = await login({
  baseUrl: project.bos!.baseUrl,
  acctId: project.bos!.acctId,
  username: project.bos!.username,
  password: project.bos!.password,
});
if (!loginResult.isSuccess) { console.error('login failed'); process.exit(1); }

console.log(`Deleting SAL_OUTSTOCK extension ${TARGET_EXT}...`);
try {
  const r = await deleteExtension(loginResult.session, TARGET_EXT, { devCode: project.bos!.devCode });
  console.log('result:', JSON.stringify(r, null, 2));
} catch (e) {
  console.error('error:', e instanceof Error ? e.message : e);
}

// Verify
console.log('\n=== SAL_OUTSTOCK extensions after delete ===');
const after = await c.listExtensions('SAL_OUTSTOCK');
console.log(JSON.stringify(after, null, 2));
process.exit(0);
