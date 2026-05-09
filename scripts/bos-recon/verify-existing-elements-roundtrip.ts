/**
 * Round-trip test:
 * 1. dcxml first save (6 head fields incl. base_property/base_data) → XML
 * 2. Feed that XML through extractExistingExtensionElements
 * 3. Verify all 6 *FieldAppearance are recovered as raw chunks
 */

import { buildAp0Plain } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import { extractExistingExtensionElements } from '../../src/main/erp/k3cloud/rpc/existing-elements';
import type { SaveExtensionRequest, BosFieldElement, BosFieldAppearance } from '../../src/main/erp/k3cloud/rpc/types';

const fields: BosFieldElement[] = [
  { type: 'ComboField', key: 'F_PAIJ_Grade', caption: '客户等级', listTabIndex: 9000, lookUpObjectId: 'enum-guid-stub', defaultCondition: 0 },
  { type: 'AmountField', key: 'F_PAIJ_CreditLimit', caption: '信用额度', listTabIndex: 9000, mustInput: true, fieldScale: 2, fieldPrecision: 18 },
  { type: 'DateField', key: 'F_PAIJ_CreditEnd', caption: '信用到期日', listTabIndex: 9000 },
  { type: 'CheckBoxField', key: 'F_PAIJ_IsFirstOrder', caption: '是否首单', listTabIndex: 9000 },
  { type: 'BaseDataField', key: 'F_PAIJ_SalesRep', caption: '关联业务员', listTabIndex: 9000, lookUpObjectId: '42d9a9bf-a383-47dc-8d37-3a1bb135bc01', srcFindFieldName: 'FNUMBER', srcDisplayFieldName: 'FNAME' },
  { type: 'BasePropertyField', key: 'F_PAIJ_SalesRepName', caption: '业务员名称', listTabIndex: 9000, controlFieldKey: 'F_PAIJ_SalesRep', srcDisplayFieldName: 'FName', defaultCondition: 67 },
];
const appearances: BosFieldAppearance[] = fields.map((f, i) => ({
  type: f.type, key: f.key, caption: f.caption, container: 'FTAB_P0',
  zOrderIndex: 99, tabindex: 9000 + i, left: 600 + i * 280, top: 30,
}));
const req: SaveExtensionRequest = {
  extension: {
    formId: '00000000000000000000000000000001', baseObjectId: 'SAL_SaleOrder',
    modelTypeId: 100, subSystemId: '23',
    name: [{ localeId: 2052, value: '信用额度管控' }],
    isv: { devCode: 'PAIJ', name: 'PAIJ', isvSignal: 'Kingdee' },
  },
  isNew: false, layoutInfoOid: 'L1', addFields: fields, addAppearances: appearances,
};

const dcxml = JSON.parse(buildAp0Plain(req)).__source__ as string;
console.log('dcxml *FieldAppearance count:', (dcxml.match(/<\w+FieldAppearance\b/g) ?? []).length);

const ext = extractExistingExtensionElements(dcxml);
console.log('\nExtracted from dcxml as if it were persisted FKERNELXML:');
console.log('  fields:', ext.fields.length);
console.log('  appearances:', ext.appearances.length);
console.log('  plugins:', ext.plugins.length);
console.log('  entries:', ext.entries.length);
console.log('  entryAppearances:', ext.entryAppearances.length);
console.log('  tabPages:', ext.tabPages.length);
console.log('  tabControls:', ext.tabControls.length);

console.log('\nappearance tags recovered:');
for (const a of ext.appearances) {
  const m = a.match(/<(\w+)\b/);
  console.log('  ', m?.[1], '— Key:', (a.match(/<Key>(\w+)<\/Key>/) ?? [])[1]);
}

if (ext.appearances.length === 6) {
  console.log('\n✅ All 6 appearances round-tripped correctly');
} else {
  console.log(`\n❌ MISMATCH — expected 6, got ${ext.appearances.length}`);
  process.exit(1);
}
