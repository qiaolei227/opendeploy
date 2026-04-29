/**
 * List all active extensions on SAL_SaleOrder, then dump each one's tabs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '../../src/shared/erp-types';

const settings = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.opendeploy', 'settings.json'), 'utf8'),
);
const project = settings.projects.find((p: Project) => p.id === settings.activeProjectId);
if (!project?.bos) process.exit(1);

const connector = new K3CloudConnector(project.bos);
await connector.connect();

const exts = await connector.listExtensions('SAL_SaleOrder');
console.log(`SAL_SaleOrder has ${exts.length} extensions:\n`);
for (const e of exts) {
  console.log(`  ${e.extId}  name=${e.name}  modify=${e.modifyDate ?? '?'}`);
}

console.log();
for (const e of exts) {
  console.log(`\n=== ext ${e.extId} (${e.name}) ===`);
  const xml = await connector.getKernelXml(e.extId).catch(() => null);
  if (!xml) {
    console.log('  (no kernel xml)');
    continue;
  }
  const tabRe = /<TabPageAppearance\b[^>]*?>[\s\S]*?<\/TabPageAppearance>/g;
  const blocks = xml.match(tabRe) ?? [];
  console.log(`  ${blocks.length} TabPageAppearance:`);
  for (const b of blocks) {
    const container = (b.match(/<Container>([^<]*)<\/Container>/) ?? [, ''])[1];
    const z = (b.match(/<ZOrderIndex>([^<]*)<\/ZOrderIndex>/) ?? [, '(missing)'])[1];
    const p = (b.match(/<PageIndex>([^<]*)<\/PageIndex>/) ?? [, '(missing)'])[1];
    const cap = (b.match(/<Caption>([^<]*)<\/Caption>/) ?? [, ''])[1];
    const key = (b.match(/<Key>([^<]*)<\/Key>/) ?? [, ''])[1];
    console.log(
      `    [${container}] ZOrderIndex=${z}  PageIndex=${p}  Key=${key}  Caption=${cap}`,
    );
  }
}

await connector.disconnect();
