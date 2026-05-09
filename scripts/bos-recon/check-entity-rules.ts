/**
 * Diagnostic: dump entity-rule state on whatever extensions currently exist
 * on SAL_SaleOrder. Cross-checks list_business_rules (TS parser) against
 * raw FKERNELXML so we know if the rule is in DB but Designer can't render
 * it, or never landed in DB at all.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '@shared/erp-types';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }

const connector = new K3CloudConnector(project.bos);
await connector.connect();
console.log('✓ connected', project.bos.baseUrl);

const exts = await connector.listExtensions('SAL_SaleOrder');
console.log(`\nFound ${exts.length} extensions on SAL_SaleOrder:`);
for (const e of exts) {
  console.log(`  - ${e.extId}  ${e.name}  (devCode=${e.developerCode}, modified ${e.modifyDate})`);
}

for (const e of exts) {
  console.log(`\n═══ ${e.extId} (${e.name}) ═══`);
  const rules = await connector.listBusinessRules(e.extId);
  console.log(`  entityRules: ${rules.entityRules.length}`);
  console.log(`  fieldUpdateActions: ${rules.fieldUpdateActions.length}`);
  if (rules.entityRules.length > 0) {
    for (const r of rules.entityRules) {
      console.log(`    · ruleId=${r.ruleId}`);
      console.log(`      description=${r.description}`);
      console.log(`      preCondition=${r.preCondition}`);
      console.log(`      services=${r.services.length}: ${r.services.map((s) => `actionId=${s.actionId}`).join(', ')}`);
    }
  }

  const xml = await connector.getKernelXml(e.extId);
  if (xml) {
    const headEntityIdx = xml.indexOf('<HeadEntity');
    if (headEntityIdx >= 0) {
      console.log(`  raw FKERNELXML has <HeadEntity at byte ${headEntityIdx}; first 500 chars:`);
      const close = xml.indexOf('</HeadEntity>', headEntityIdx);
      const slice = xml.slice(headEntityIdx, close > 0 ? close + 14 : headEntityIdx + 800);
      console.log('    ' + slice.replace(/\n/g, '\n    ').slice(0, 1500));
    } else {
      console.log(`  raw FKERNELXML has NO <HeadEntity element (${xml.length} chars total)`);
      const ruleIdx = xml.indexOf('EntityServiceRule');
      console.log(`  EntityServiceRule mention at byte: ${ruleIdx}`);
    }
  }
}

await connector.disconnect();
process.exit(0);
