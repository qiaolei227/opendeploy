/**
 * Smoke: feed the real captured GetBusinessObjectMetaData payload through
 * parseMetaDataXml + the existing parseFieldsFromKernelXml /
 * parseFormPluginsFromKernelXml. Verifies the parser composes correctly
 * against ground truth — proves the SQL→RPC swap is parser-clean.
 */
import { readFileSync } from 'node:fs';
import { parseMetaDataXml, extractKernelXml } from '../../src/main/erp/k3cloud/rpc/metadata-xml';
import {
  parseFieldsFromKernelXml,
  parseFormPluginsFromKernelXml,
} from '../../src/main/erp/k3cloud/fkernel-parsers';

const xmlPath = process.argv[2] ?? '.scratch/getbomd/SAL_SaleOrder/metaData.xml';
console.log('--- file:', xmlPath, '---');
const xml = readFileSync(xmlPath, 'utf-8');
console.log('size:', xml.length, 'chars');
console.log();

const env = parseMetaDataXml(xml);
console.log('=== Envelope ===');
console.log('  objectId :', env.objectId);
console.log('  tableName:', env.tableName);
console.log('  scalar columns:', Object.keys(env.columns).length);
console.log('  xml columns:', Object.keys(env.xmlColumns));
console.log();

console.log('=== Selected scalar columns ===');
for (const k of ['FID', 'FBASEOBJECTID', 'FMODELTYPEID', 'FSUPPLIERNAME', 'FINHERITPATH']) {
  console.log(`  [${k}] = ${JSON.stringify(env.columns[k] ?? null).slice(0, 100)}`);
}
console.log();

const kernelXml = extractKernelXml(xml);
console.log('=== KernelXml extraction ===');
console.log('  length:', kernelXml.length);
console.log('  starts with:', kernelXml.slice(0, 80).replace(/\n/g, ' '));
console.log();

console.log('=== parseFieldsFromKernelXml ===');
const fields = parseFieldsFromKernelXml(kernelXml);
console.log('  field count:', fields.length);
console.log('  sample (first 5):');
for (const f of fields.slice(0, 5)) {
  console.log(`    - ${f.key} (${f.type}) name="${f.name}" entity=${f.entryKey ?? '<head>'}`);
}
console.log();

console.log('=== parseFormPluginsFromKernelXml ===');
const plugins = parseFormPluginsFromKernelXml(kernelXml);
console.log('  plugin count:', plugins.length);
for (const p of plugins.slice(0, 6)) {
  console.log(`    - ${p.type} ${p.className?.split(',')[0] ?? '<inline>'}`);
}
