import { readFileSync } from 'node:fs';
import { extractExistingExtensionElements } from '../../src/main/erp/k3cloud/rpc/existing-elements';

const xml = readFileSync('.scratch/ext-raw-493fb6b7.xml', 'utf-8');
console.log('XML length:', xml.length);
const r = extractExistingExtensionElements(xml);
console.log('  fields:        ', r.fields.length);
console.log('  appearances:   ', r.appearances.length);
console.log('  plugins:       ', r.plugins.length);
console.log('  entries:       ', r.entries.length);
console.log('  entryAppearances:', r.entryAppearances.length);
console.log('  tabPages:      ', r.tabPages.length);
console.log('  tabControls:   ', r.tabControls.length);
console.log('  formOperations:', r.formOperations.length);
console.log('  headEntity:    ', r.headEntity.length, 'chars');
console.log('\nfields key+EntityKey:');
for (const f of r.fields) {
  const k = f.match(/<Key>([^<]+)<\/Key>/)?.[1] ?? '?';
  const ek = f.match(/<EntityKey>([^<]+)<\/EntityKey>/)?.[1];
  const tag = f.match(/^<(\w+)\b/)?.[1] ?? '?';
  console.log(`  ${tag.padEnd(20)} ${k.padEnd(28)} entity=${ek ?? '(head)'}`);
}
