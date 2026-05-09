/**
 * Verify the existingHeadEntityRaw round-trip fix — entity-level
 * EntityServiceRule injected via saveExtensionRaw must survive a subsequent
 * envelope-rebuild save (saveExtension(req)).
 *
 * Reproduces the silent drop discovered 2026-05-08 via "信用额度管控" e2e:
 * agent added entity Calculate (raw save → IsSuccess=true) but later
 * register_python_plugins / add_toolbar_button via envelope rebuild dropped
 * the HeadEntity overlay because existing-elements never extracted it.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/verify-entity-rule-survives-envelope-rebuild.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '@shared/erp-types';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }

const EXT_ID = process.env.EXT_ID ?? '493fb6b7ab32433ba201ea06920522e2';

const connector = new K3CloudConnector(project.bos);
await connector.connect();
console.log('✓ connected', project.bos.baseUrl);

// Step 1 — read baseline.
const before = await connector.listBusinessRules(EXT_ID);
console.log(`\nBaseline: ${before.entityRules.length} entityRules, ${before.fieldUpdateActions.length} fieldUpdateActions`);

// Step 2 — add a fresh entity rule via raw save.
const ruleId = randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
const serviceId = randomBytes(16).toString('hex');
console.log(`\nStep A — add entity rule (raw save) ruleId=${ruleId.slice(0,8)}...`);
await connector.addEntityServiceRule({
  extensionFid: EXT_ID,
  ruleId,
  description: 'envelope-rebuild-survival-test',
  preCondition: 'True',
  preConditionDesc: '永远触发',
  services: [{
    className: 'FormBusinessService',
    actionId: 2,
    id: serviceId,
    properties: { Parameters: JSON.stringify(['F_PAIJ_IsFirstOrder = False']) },
  }],
});

const afterRaw = await connector.listBusinessRules(EXT_ID);
console.log(`After raw save: ${afterRaw.entityRules.length} entityRules`);
const justAdded = afterRaw.entityRules.find((r) => r.ruleId === ruleId);
if (!justAdded) {
  console.error(`❌ Step A failed — entity rule not in DB after raw save`);
  process.exit(2);
}
console.log('✓ Step A ok — entity rule landed via raw save');

// Step 3 — trigger an envelope-rebuild save via add_toolbar_button (no
// matter what we add, the round-trip will read existing buckets and re-emit
// the envelope; pre-fix that would drop the HeadEntity overlay).
const tempButtonKey = `RoundTripTest_${Date.now().toString(36)}`;
const ops = await connector.listOperations(EXT_ID);
const op = ops.operations[0];
if (!op) { console.error('no operation on this extension to bind a button to'); process.exit(1); }

console.log(`\nStep B — envelope-rebuild save via add_toolbar_button(${tempButtonKey} on form-level toolbar)…`);
await connector.addToolbarButton({
  extensionFid: EXT_ID,
  target: { kind: 'form' },
  buttonKey: tempButtonKey,
  buttonId: randomBytes(16).toString('hex'),
  caption: '回环测试按钮',
  seq: 99,
  boundOperationKey: op.operationKey,
  boundOperationName: op.operationName ?? op.operationKey,
  toolbarKey: 'FToolBar',
  barDataManagerId: randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
  formBusinessServiceId: randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
  barItemLinkId: randomBytes(16).toString('hex'),
});
console.log('✓ Step B ok — envelope-rebuild save returned IsSuccess=true');

// Step 4 — check entity rule survived.
const afterEnvelope = await connector.listBusinessRules(EXT_ID);
console.log(`\nAfter envelope-rebuild: ${afterEnvelope.entityRules.length} entityRules`);
const survived = afterEnvelope.entityRules.find((r) => r.ruleId === ruleId);
if (!survived) {
  console.error(`\n❌ FAIL — entity rule ${ruleId.slice(0,8)} silently dropped by envelope rebuild`);
  console.error(`This is the silent-drop bug existingHeadEntityRaw fix is supposed to prevent.`);
  process.exit(3);
}
console.log(`\n✅ PASS — entity rule survived envelope-rebuild save`);
console.log(`   ruleId=${survived.ruleId}`);
console.log(`   entityKey=${survived.entityKey}`);
console.log(`   description=${survived.description}`);

// Cleanup the temp button so we don't pollute (rule we leave for user
// inspection — they can verify in Designer).
console.log(`\nCleaning up temp button ${tempButtonKey}...`);
await connector.removeToolbarButton(EXT_ID, tempButtonKey);
console.log('✓ temp button removed');

await connector.disconnect();
process.exit(0);
