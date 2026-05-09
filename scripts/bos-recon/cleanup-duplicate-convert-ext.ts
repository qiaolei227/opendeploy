/**
 * Find duplicate convert-rule extensions on SaleOrder-OutStock for the
 * current project, and delete all-but-the-newest via the BOS RPC delete
 * tool. Restores single-layer-tree invariant.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { listConvertRuleExtsByOrigin } from '../../src/main/erp/k3cloud/rpc/convert-rule-state';
import { setActiveProject, setBundledConvertRuleBaselines, getConnectionState } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import type { Project } from '@shared/erp-types';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }

// Bootstrap baselines (extendConvertRule hook needs them, even though delete doesn't).
const originXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'), 'utf-8',
);
const extensionTemplateXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'), 'utf-8',
);
setBundledConvertRuleBaselines({
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({ originXml, extensionTemplateXml }),
});

await setActiveProject(project);
const connState = getConnectionState();
if (connState.status !== 'connected') {
  console.error('connect failed:', connState.error); process.exit(1);
}

const exts = await listConvertRuleExtsByOrigin(project.id, 'SaleOrder-OutStock');
console.log(`Found ${exts.length} local-tracked SaleOrder-OutStock extensions:`);
exts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
for (const e of exts) {
  console.log(`  extId=${e.extId} createdAt=${e.createdAt}`);
}
if (exts.length <= 1) {
  console.log('Nothing to clean up.');
  process.exit(0);
}

const newest = exts[exts.length - 1];
console.log(`\nKeeping newest: ${newest.extId} (${newest.createdAt})`);
console.log(`Will delete the other ${exts.length - 1}:`);
for (const e of exts.slice(0, -1)) {
  console.log(`  → deleting ${e.extId}…`);
  // Active-project connector lives behind setActiveProject; use it.
  const connector = (await import('../../src/main/erp/active')).getActiveConnector() as K3CloudConnector | null;
  if (!connector) { console.error('no active connector'); process.exit(1); }
  try {
    await connector.deleteConvertRuleExtension('SaleOrder-OutStock', e.extId);
    console.log(`    ✓ deleted`);
  } catch (err) {
    console.log(`    ❌ delete failed: ${(err as Error).message.slice(0,200)}`);
  }
}

const remaining = await listConvertRuleExtsByOrigin(project.id, 'SaleOrder-OutStock');
console.log(`\nDone. Remaining: ${remaining.length}`);
process.exit(0);
