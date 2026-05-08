/**
 * Verify list-menu button wire path:
 * call connector.addToolbarButton with target.kind='list', then read back
 * via listOperations and assert the button exists with menuLocation='listMenu'.
 *
 * Uses the level-1 extension (6ba3444d…) which already carries the
 * AgentLoopOp operation we built in round 2.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/verify-list-menu-button.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '@shared/erp-types';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }

const LEVEL1_EXT = '6ba3444d39624d15ae89c78e82a4f480';
const BUTTON_KEY = 'AgentLoopListBtn';

const connector = new K3CloudConnector(project.bos);
await connector.connect();
console.log('✓ connected', project.bos.baseUrl);

// Pre-flight: confirm AgentLoopOp exists.
const before = await connector.listOperations(LEVEL1_EXT);
const op = before.operations.find((o) => o.operationKey === 'AgentLoopOp');
if (!op) {
  console.error('AgentLoopOp not found on level-1 extension — round 2 must have removed it');
  process.exit(1);
}
console.log(`✓ found AgentLoopOp (id=${op.operationId}, name=${op.operationName})`);

const buttonId = randomBytes(16).toString('hex');
const barDataManagerId = randomUUID();
const formBusinessServiceId = randomUUID();
const barItemLinkId = randomBytes(16).toString('hex');

console.log('\nAdding list-menu button via connector.addToolbarButton(target.kind="list")...');
console.log(`  buttonKey: ${BUTTON_KEY}`);
console.log(`  buttonId : ${buttonId}`);

await connector.addToolbarButton({
  extensionFid: LEVEL1_EXT,
  target: { kind: 'list' },
  buttonKey: BUTTON_KEY,
  buttonId,
  caption: 'AgentLoop 列表菜单按钮',
  seq: 1,
  boundOperationKey: 'AgentLoopOp',
  boundOperationName: op.operationName,
  toolbarKey: 'FToolBar',
  barDataManagerId,
  formBusinessServiceId,
  barItemLinkId,
});
console.log('✓ addToolbarButton succeeded');

console.log('\nReading back via listOperations...');
const after = await connector.listOperations(LEVEL1_EXT);
const matched = after.toolbarButtons.find((b) => b.buttonKey === BUTTON_KEY);
if (!matched) {
  console.error('\n❌ Button NOT found on read-back. All toolbarButtons:');
  console.error(JSON.stringify(after.toolbarButtons, null, 2));
  process.exit(2);
}

console.log('\n✓ Button found:', JSON.stringify(matched, null, 2));

if (matched.menuLocation !== 'listMenu') {
  console.error(`\n❌ menuLocation expected "listMenu", got "${matched.menuLocation}"`);
  process.exit(3);
}
console.log('\n✅ menuLocation correctly tagged as "listMenu" — list-menu wire path works');

await connector.disconnect();
process.exit(0);
