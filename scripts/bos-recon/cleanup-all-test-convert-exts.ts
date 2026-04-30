/**
 * Bulk-delete every convert-rule extension we created during simulate / probe
 * runs, restoring the BOS DB to the pre-OpenDeploy state. Solves the
 * "PRIMARY KEY 约束 dbo.@PKValue_udt2 ... 重复键 (SAL_OUTSTOCK)" error
 * BOS Designer hits when too many SAL_OUTSTOCK-targeted rules exist.
 *
 * Reads extIds from every project's convert-rule-ext state directory under
 * ~/.opendeploy/projects/, then issues deleteConvertRuleExtension on the
 * customer's live K/3 server (not the disk copies — the state files are
 * just the registry of what we built).
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { setActiveProject, setBundledConvertRuleBaselines, getActiveConnector } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import type { Project } from '@shared/erp-types';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }

setBundledConvertRuleBaselines({
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({
    originXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'), 'utf-8'),
    extensionTemplateXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'), 'utf-8'),
  }),
});
await setActiveProject(project);
const c = getActiveConnector()!;
console.log('connected to', project.bos.baseUrl);

// Gather every ext state file across all projects
const projectsDir = resolve(homedir(), '.opendeploy/projects');
const allExts: { extId: string; originRuleId: string; statePath: string }[] = [];
for (const projDir of readdirSync(projectsDir)) {
  const stateDir = resolve(projectsDir, projDir, 'convert-rule-ext');
  if (!existsSync(stateDir)) continue;
  for (const f of readdirSync(stateDir)) {
    if (!f.endsWith('.json')) continue;
    const p = resolve(stateDir, f);
    try {
      const s = JSON.parse(readFileSync(p, 'utf-8'));
      allExts.push({ extId: s.extId ?? basename(f, '.json'), originRuleId: s.originRuleId ?? 'SaleOrder-OutStock', statePath: p });
    } catch (e) {
      console.warn('skip unreadable state:', p);
    }
  }
}
console.log(`\nfound ${allExts.length} ext state files`);

let deleted = 0; let failed = 0;
for (const e of allExts) {
  process.stdout.write(`  delete ${e.extId} (${e.originRuleId})… `);
  try {
    const r = await c.deleteConvertRuleExtension(e.originRuleId, e.extId);
    if (r.ok) {
      console.log('✓');
      deleted++;
      try { unlinkSync(e.statePath); } catch {}
    } else {
      console.log(`server rejected: ${r.raw.slice(0, 100)}`);
      failed++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('does not exist') || msg.includes('不存在') || msg.includes('找不到')) {
      console.log('(already gone)');
      deleted++;
      try { unlinkSync(e.statePath); } catch {}
    } else {
      console.log(`✗ ${msg.slice(0, 120)}`);
      failed++;
    }
  }
}

console.log(`\nDone — ${deleted} deleted, ${failed} failed.`);
console.log('\nNext: refresh BOS Designer (close client + relogin) — the PK error should be gone.');
console.log('If "(停用)" residuals still show in the rule list, right-click → delete in Designer to clear them.');
process.exit(0);
