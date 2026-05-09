/**
 * Dump the dcxml wire that add_fields would produce for the failing
 * "信用额度管控" 6-headfield batch — to confirm whether all 6
 * *FieldAppearance elements actually appear in the envelope or are
 * silently dropped by the dcxml emitter / buildSaveRequest pipeline.
 */

import { buildAp0Plain } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
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
  type: f.type,
  key: f.key,
  caption: f.caption,
  container: 'FTAB_P0',
  zOrderIndex: 99,
  tabindex: 9000 + i,
  left: 600 + i * 280,
  top: 30,
}));

const req: SaveExtensionRequest = {
  extension: {
    formId: '00000000000000000000000000000001',
    baseObjectId: 'SAL_SaleOrder',
    modelTypeId: 100,
    subSystemId: '23',
    name: [{ localeId: 2052, value: '信用额度管控' }],
    isv: { devCode: 'PAIJ', name: 'PAIJ', isvSignal: 'Kingdee' },
  },
  isNew: false,
  layoutInfoOid: 'L1',
  addFields: fields,
  addAppearances: appearances,
};

const ap0 = buildAp0Plain(req);
const dcxml = JSON.parse(ap0).__source__ as string;

// Count *FieldAppearance
const matches = dcxml.match(/<\w+FieldAppearance\b/g) ?? [];
console.log(`*FieldAppearance count in wire: ${matches.length}`);
console.log(`tags found:`, [...new Set(matches)]);

// Check that BasePropertyFieldAppearance appears
if (dcxml.includes('<BasePropertyFieldAppearance')) {
  console.log('✓ BasePropertyFieldAppearance present');
  const m = dcxml.match(/<BasePropertyFieldAppearance[\s\S]*?<\/BasePropertyFieldAppearance>/);
  if (m) console.log('---\n' + m[0] + '\n---');
} else {
  console.log('❌ BasePropertyFieldAppearance MISSING from wire');
}

// Look for the BaseDataFieldAppearance to compare
if (dcxml.includes('<BaseDataFieldAppearance')) {
  const m = dcxml.match(/<BaseDataFieldAppearance[\s\S]*?<\/BaseDataFieldAppearance>/);
  if (m) console.log('\nBaseDataFieldAppearance:\n' + m[0] + '\n');
}
