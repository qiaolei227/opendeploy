import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: any = settings.projects?.[0];
const c = new K3CloudConnector(project.bos);
await c.connect();

// BD_Empinfo lookup class GUID we saw earlier in the dump:
const guid = '42d9a9bf-a383-47dc-8d37-3a1bb135bc01';
console.log('Trying getFields(GUID)…');
try {
  const r = await c.getFields(guid);
  console.log('  count:', r.length, '— first 5:');
  for (const f of r.slice(0, 5)) console.log(`    ${f.key} ${f.type} ${f.name}`);
} catch (e) {
  console.log('  FAIL:', (e as Error).message.slice(0, 200));
}

console.log('\nTrying getObject(GUID) to see if it resolves to a form id…');
try {
  const o = await c.getObject(guid);
  console.log('  result:', JSON.stringify(o));
} catch (e) {
  console.log('  FAIL:', (e as Error).message.slice(0, 200));
}

await c.disconnect();
