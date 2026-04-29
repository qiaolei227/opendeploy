/**
 * Diagnostic: pull SAL_SaleOrder FKERNELXML and dump its TabPageAppearance
 * elements, so we can verify that the parent's native tabs carry
 * `<ZOrderIndex>` (which is what `nextZOrderIndex` relies on).
 *
 * If parent tabs have ZOrderIndex 0..7 → max+1 = 8 (matches BOS Designer).
 * If parent tabs lack ZOrderIndex → our algorithm sees max=-1 → returns 0
 * (the bug user is reporting).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { parseFormLayoutContainers } from '../../src/main/erp/k3cloud/fkernel-parsers';
import type { Project } from '../../src/shared/erp-types';

const settings = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.opendeploy', 'settings.json'), 'utf8'),
);
const project = settings.projects.find((p: Project) => p.id === settings.activeProjectId);
if (!project?.bos) {
  console.error('No active project with bos creds.');
  process.exit(1);
}

const connector = new K3CloudConnector(project.bos);
await connector.connect();
console.log('connected.');

const xml = await connector.getKernelXml('SAL_SaleOrder');
if (!xml) {
  console.error('SAL_SaleOrder FKERNELXML is empty.');
  process.exit(1);
}

console.log('parent xml length:', xml.length);

// Show all TabPageAppearance blocks under FTab1 (entry-side TabControl).
const tabRe = /<TabPageAppearance\b[^>]*?>[\s\S]*?<\/TabPageAppearance>/g;
const blocks = xml.match(tabRe) ?? [];
console.log(`\nfound ${blocks.length} TabPageAppearance blocks total.\n`);

for (const b of blocks) {
  const container = (b.match(/<Container>([^<]*)<\/Container>/) ?? [, ''])[1];
  const z = (b.match(/<ZOrderIndex>([^<]*)<\/ZOrderIndex>/) ?? [, '(missing)'])[1];
  const cap = (b.match(/<Caption>([^<]*)<\/Caption>/) ?? [, ''])[1];
  const key = (b.match(/<Key>([^<]*)<\/Key>/) ?? [, ''])[1];
  console.log(`  [${container}] ZOrderIndex=${z}  Key=${key}  Caption=${cap}`);
}

console.log('\n--- via parseFormLayoutContainers ---');
const layout = parseFormLayoutContainers(xml);
for (const t of layout.tabs) {
  console.log(
    `  parentControl=${t.parentControl}  zOrderIndex=${t.zOrderIndex}  key=${t.key}  caption=${t.caption}`,
  );
}

await connector.disconnect();
