/**
 * One-shot fix for the entity rule that was added without preConditionDesc
 * on extension c7d1a0ea (信用额度管控). Deletes the old rule + re-adds
 * with preConditionDesc=description so BOS Designer shows the rule
 * condition column populated.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: any = settings.projects?.[0];
const c = new K3CloudConnector(project.bos);
await c.connect();
console.log('✓ connected');

const EXT = 'c7d1a0ea027241b0976e79332e07d587';

// 1. Find the entity rule with description "首单默认 C 级" (or similar).
const list = await c.listBusinessRules(EXT);
const target = list.entityRules.find((r) =>
  r.description.includes('首单默认') || r.description.includes('C 级')
);
if (!target) {
  console.error('No matching entity rule found. Existing rules:');
  for (const r of list.entityRules) {
    console.error(`  ruleId=${r.ruleId} desc=${r.description}`);
  }
  process.exit(1);
}
console.log(`Found rule ${target.ruleId} (${target.description})`);
console.log(`  preCondition: ${target.preCondition}`);
console.log(`  preConditionDesc: "${target.preConditionDesc ?? ''}"`);

// 2. Delete it.
console.log('\nDeleting old rule...');
await c.removeBusinessRule(EXT, target.ruleId);
console.log('  ✓ deleted');

// 3. Re-add with preConditionDesc.
const newRuleId = randomUUID();
const serviceId = randomBytes(16).toString('hex');
console.log(`\nRe-adding with preConditionDesc=description (${target.description})...`);
await c.addEntityServiceRule({
  extensionFid: EXT,
  ruleId: newRuleId,
  description: target.description,
  preCondition: target.preCondition,
  preConditionDesc: target.description,
  services: target.services.map((s) => ({
    className: s.className,
    actionId: s.actionId,
    id: randomBytes(16).toString('hex'),
    properties: { Parameters: s.parameters },
  })),
});
console.log(`  ✓ re-added ruleId=${newRuleId}`);

// 4. Verify.
const after = await c.listBusinessRules(EXT);
const verified = after.entityRules.find((r) => r.ruleId === newRuleId);
if (verified) {
  console.log('\n✅ Verification:');
  console.log(`  description: ${verified.description}`);
  console.log(`  preCondition: ${verified.preCondition}`);
  console.log(`  preConditionDesc: "${verified.preConditionDesc}"`);
} else {
  console.error('\n❌ New rule not found on read-back');
  process.exit(2);
}

await c.disconnect();
process.exit(0);
