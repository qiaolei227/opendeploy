/**
 * Dump full TabPageAppearance XML so we can spot which child element BOS
 * Designer's "页签序号" property actually maps to.
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

const targets = [
  { id: 'SAL_SaleOrder', label: 'parent SAL_SaleOrder' },
  { id: '8bb9fa93c4b045fea8aee856bcb63581', label: 'extension 销售订单' },
];

for (const t of targets) {
  console.log(`\n====================== ${t.label} (${t.id}) ======================`);
  const xml = await connector.getKernelXml(t.id);
  if (!xml) {
    console.log('  (no kernel xml)');
    continue;
  }
  const tabRe = /<TabPageAppearance\b[^>]*?>[\s\S]*?<\/TabPageAppearance>/g;
  const blocks = xml.match(tabRe) ?? [];
  for (const b of blocks) {
    const cap = (b.match(/<Caption>([^<]*)<\/Caption>/) ?? [, ''])[1];
    const key = (b.match(/<Key>([^<]*)<\/Key>/) ?? [, ''])[1];
    console.log(`\n--- ${key}  Caption=${cap} ---`);
    console.log(b);
  }
}

await connector.disconnect();
