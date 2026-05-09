/**
 * Repro v2: trigger via add_toolbar_button(target.kind='list')
 * to see if the list-menu wire path is what's silent-dropping
 * the head *FieldAppearance.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '@shared/erp-types';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
const c = new K3CloudConnector(project!.bos!);
await c.connect();

const EXT = '843a58f292a54251b514a045055e7825';

console.log('Before any action:');
const xmlBefore = (await c.getKernelXml(EXT))!;
const beforeApps = (xmlBefore.match(/<\w+FieldAppearance\b/g) ?? []);
console.log('  *FieldAppearance:', beforeApps.length, '|', [...new Set(beforeApps)].join(', '));

// Step A: add a custom operation (so we have something to bind a list button to)
const ops = await c.listOperations(EXT);
let opKey = ops.operations.find((o) => o.operationKey?.startsWith('DBG_'))?.operationKey;
if (!opKey) {
  console.log('\nStep A — add_custom_operation DBG_Op…');
  await c.addCustomOperation({
    extensionFid: EXT,
    operationKey: 'DBG_Op',
    operationName: '调试操作',
    operationId: 45,
    pluginClassName: 'dbg_plugin',
    pyBody: '# dbg',
  });
  opKey = 'DBG_Op';

  const xmlA = (await c.getKernelXml(EXT))!;
  const a = (xmlA.match(/<\w+FieldAppearance\b/g) ?? []);
  console.log('  After op: *FieldAppearance:', a.length);
}

// Step B: add list-menu button
console.log('\nStep B — add_toolbar_button target.kind=list…');
await c.addToolbarButton({
  extensionFid: EXT,
  target: { kind: 'list' },
  buttonKey: 'DBG_ListBtn',
  buttonId: randomBytes(16).toString('hex'),
  caption: '列表测试',
  seq: 1,
  boundOperationKey: opKey!,
  boundOperationName: '调试操作',
  toolbarKey: 'FToolBar',
  barDataManagerId: randomUUID(),
  formBusinessServiceId: randomUUID(),
  barItemLinkId: randomBytes(16).toString('hex'),
});

const xmlAfter = (await c.getKernelXml(EXT))!;
const afterApps = (xmlAfter.match(/<\w+FieldAppearance\b/g) ?? []);
console.log('  After list-menu button: *FieldAppearance:', afterApps.length, '|', [...new Set(afterApps)].join(', '));

if (afterApps.length < beforeApps.length) {
  console.log(`\n❌ DROP — went from ${beforeApps.length} to ${afterApps.length} after list-menu add`);
} else {
  console.log(`\n✓ No drop`);
}
await c.disconnect();
