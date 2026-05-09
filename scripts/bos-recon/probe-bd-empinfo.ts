import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: any = settings.projects?.[0];
const c = new K3CloudConnector(project.bos);
await c.connect();

const fields = await c.getFields('BD_Empinfo');
console.log('BD_Empinfo total fields:', fields.length);
console.log('\nfields containing "Name" or "Number":');
for (const f of fields) {
  if (/name|number/i.test(f.key)) console.log(`  ${f.key.padEnd(30)} ${f.type.padEnd(20)} ${f.name}`);
}
console.log('\nfirst 10 fields:');
for (const f of fields.slice(0, 10)) console.log(`  ${f.key.padEnd(30)} ${f.type.padEnd(20)} ${f.name}`);

await c.disconnect();
