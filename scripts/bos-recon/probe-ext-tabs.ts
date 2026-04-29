/**
 * Diagnostic: dump the test extension's TabPageAppearance blocks to see
 * what ZOrderIndex they currently carry on the live BOS server.
 *
 * Usage: pnpm tsx scripts/bos-recon/probe-ext-tabs.ts <extId>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '../../src/shared/erp-types';

const extId = process.argv[2] ?? '7150e1c7aa05487eb3925decee1085c2';

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

const xml = await connector.getKernelXml(extId);
if (!xml) {
  console.error(`Extension ${extId} FKERNELXML is empty.`);
  process.exit(1);
}

console.log(`ext ${extId} kernel xml length: ${xml.length}\n`);

const tabRe = /<TabPageAppearance\b[^>]*?>[\s\S]*?<\/TabPageAppearance>/g;
const blocks = xml.match(tabRe) ?? [];
console.log(`found ${blocks.length} TabPageAppearance blocks:\n`);

for (const b of blocks) {
  const container = (b.match(/<Container>([^<]*)<\/Container>/) ?? [, ''])[1];
  const z = (b.match(/<ZOrderIndex>([^<]*)<\/ZOrderIndex>/) ?? [, '(missing)'])[1];
  const p = (b.match(/<PageIndex>([^<]*)<\/PageIndex>/) ?? [, '(missing)'])[1];
  const cap = (b.match(/<Caption>([^<]*)<\/Caption>/) ?? [, ''])[1];
  const key = (b.match(/<Key>([^<]*)<\/Key>/) ?? [, ''])[1];
  console.log(
    `  [${container}] ZOrderIndex=${z}  PageIndex=${p}  Key=${key}  Caption=${cap}`,
  );
}

await connector.disconnect();
