/**
 * Sanity check: load the real 240KB GetConvertRule JSON sample and run it
 * through the summarizer to verify shape + extraction + size compression.
 */
import * as fs from 'node:fs';
import { summarizeConvertRule } from '../../src/main/erp/k3cloud/convert-rule-summarizer';

const sample = JSON.parse(
  fs.readFileSync('.scratch/convert-rule-recon/ConvertService_GetConvertRule_SaleOrder_OutStock_.json', 'utf8'),
);
const summary = summarizeConvertRule(sample);

console.log('--- summary stats ---');
console.log('  ruleId       :', summary.ruleId);
console.log('  displayName  :', summary.displayName);
console.log('  source/target:', summary.sourceFormId, '→', summary.targetFormId);
console.log('  isDefault    :', summary.isDefault, '  isActive:', summary.isActive);
console.log('  convertType  :', summary.convertType);
console.log('  extension    :');
console.log('    hasExtends :', summary.extension.hasExtends);
console.log('    originId   :', summary.extension.originId);
console.log('    isv        :', summary.extension.isv);
console.log('    isInheritView:', summary.extension.isInheritView);
console.log('    lineage    :');
summary.extension.lineage.forEach((e) => console.log('      ', e.id, '   (' + e.displayName + ')'));
console.log('  defaultConvert:');
console.log('    fieldMapCount:', summary.defaultConvert?.fieldMapCount);
console.log('    formulaMaps  :', summary.defaultConvert?.formulaMaps.length);
console.log('    aggregateMaps:', summary.defaultConvert?.aggregateMaps.length);
console.log('  groupBy      :', summary.groupBy?.mode, '→', summary.groupBy?.fields);
console.log('  plugins      :', summary.plugins.length);
console.log('  billTypeMaps :', summary.billTypeMaps.length);
console.log('  attachment   :', summary.attachment);
console.log('  linkEntity   :', summary.linkEntity);

console.log('\n--- formulaMaps ---');
summary.defaultConvert?.formulaMaps.forEach((f) => {
  const fm = (f.formula || '').slice(0, 80);
  console.log('   ', f.target, '→', fm);
});

console.log('\n--- size compression ---');
const json = JSON.stringify(summary);
const rawSize = JSON.stringify(sample).length;
console.log('  raw    :', rawSize.toLocaleString(), 'bytes');
console.log('  summary:', json.length.toLocaleString(), 'bytes (' + ((100 * json.length) / rawSize).toFixed(2) + '%)');
