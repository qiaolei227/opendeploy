/**
 * Verify the multi-layer extension entity-rule fix:
 * call addEntityServiceRule on the level-2 extension we built in mega2,
 * then read back via listBusinessRules.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/verify-entity-rule-fix.ts
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

const LEVEL2_EXT = process.env.EXT_ID ?? '493fb6b7ab32433ba201ea06920522e2';

const connector = new K3CloudConnector(project.bos);
await connector.connect();
console.log('✓ connected', project.bos.baseUrl);

const ruleId = randomBytes(16).toString('hex').replace(
  /(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
const serviceId = randomBytes(16).toString('hex');

console.log(`\nAdding entity-level Calculate rule to level-2 extension ${LEVEL2_EXT}...`);
console.log(`  ruleId  : ${ruleId}`);
console.log(`  serviceId: ${serviceId}`);

const result = await connector.addEntityServiceRule({
  extensionFid: LEVEL2_EXT,
  ruleId,
  description: 'agent-loop 实体级 Calculate (multi-layer fix verify)',
  preCondition: 'True',
  preConditionDesc: '永远触发',
  services: [{
    className: 'FormBusinessService',
    actionId: 2,
    id: serviceId,
    properties: { Parameters: JSON.stringify(['F_AL2_Int = 100']) },
  }],
});
console.log('\n✓ addEntityServiceRule succeeded:', result);

console.log('\nReading back via listBusinessRules...');
const list = await connector.listBusinessRules(LEVEL2_EXT);
console.log(`  entityRules: ${list.entityRules.length}`);
console.log(`  fieldUpdateActions: ${list.fieldUpdateActions.length}`);
const matched = list.entityRules.find((r) => r.ruleId === ruleId);
if (matched) {
  console.log('\n✅ Entity rule found on read-back:', JSON.stringify(matched, null, 2));
} else {
  console.log('\n❌ Entity rule NOT found on read-back. All entityRules:');
  console.log(JSON.stringify(list.entityRules, null, 2));
  process.exit(2);
}

await connector.disconnect();
process.exit(0);
