/**
 * Route B (envelope rebuild) wire-replay fixtures.
 *
 * Each case = one frozen input that we run through `buildAp0Plain` and
 * `toMatchFileSnapshot` against. See README.md in this directory for the
 * full convention. Adding a case → add an entry here + commit the
 * resulting snapshot file from your first `pnpm test wire-replay` run.
 */

import type { SaveExtensionRequest } from '../../../src/main/erp/k3cloud/rpc/types';

export interface RouteBCase {
  name: string;
  whyMatters: string;
  input: SaveExtensionRequest;
}

const BASELINE_EXT: SaveExtensionRequest['extension'] = {
  formId: '00000000000000000000000000000001',
  baseObjectId: 'SAL_SaleOrder',
  modelTypeId: 100,
  subSystemId: '23',
  name: [{ localeId: 2052, value: '销售订单扩展(test)' }],
  isv: { devCode: 'TEST', name: 'TEST', isvSignal: 'Kingdee' },
};

export const ROUTE_B_CASES: RouteBCase[] = [
  {
    name: 'isnew-empty',
    whyMatters:
      'Smallest baseline — Form root + LayoutInfo only. Catches refactor that ' +
      'changes Form scaffolding shape (oid="BOS_BillModel", ElementType="100"). ' +
      'Per docs/architecture/bos-write-routes.md §3 Route B: every save ships a Form node.',
    input: {
      extension: BASELINE_EXT,
      isNew: true,
      layoutInfoOid: 'aaaa-bbbb-cccc-dddd',
    },
  },

  {
    name: 'add-textfield-basic',
    whyMatters:
      'Most common write: one TextField. Catches dcxml.ts emitter regressions ' +
      'on field shape (FieldName casing, key/Id duplication, baseline 7 children). ' +
      'Memory bos_dcxml_element_schema.md spells out the canonical shape.',
    input: {
      extension: BASELINE_EXT,
      isNew: false,
      layoutInfoOid: 'L1',
      addFields: [
        {
          type: 'TextField',
          key: 'FOpenDeployTest',
          caption: '测试字段',
          listTabIndex: 100,
          id: '11111111-1111-1111-1111-111111111111',
        },
      ],
      addAppearances: [
        {
          type: 'TextField',
          key: 'FOpenDeployTest',
          caption: '测试字段',
          tabindex: 100,
        },
      ],
    },
  },

  {
    name: 'add-custom-operation-with-python-plugin',
    whyMatters:
      'Plan 5.12.6 hotfix #4 case — addFormOperations + ServicePlugin Python inline. ' +
      'Catches F5 (envelope-existingXxx omitted): if the case ever stops emitting ' +
      'every existingXxxRaw bucket the test catches it. ' +
      'Source pattern: connector.addCustomOperation() at connector.ts:1135-1163.',
    input: {
      extension: BASELINE_EXT,
      isNew: false,
      layoutInfoOid: 'L1',
      // Real connector usage extracts these from the live extension via
      // extractExistingExtensionElements; we hard-code 1 of each here so the
      // snapshot proves they round-trip into the right buckets.
      existingFieldsRaw: ['<TextField oid="FExistingFieldA" />'],
      existingPluginsRaw: ['<PlugIn oid="ExistingPluginA"><ClassName>X</ClassName></PlugIn>'],
      existingFormOperationsRaw: ['<FormOperation oid="ExistingOp"><Id>ExistingOp</Id></FormOperation>'],
      addFormOperations: [
        {
          service: 'OpdpTest',
          operationId: 45,
          operationName: '测试操作',
          operationParameterId: '11111111-2222-3333-4444-555555555555',
          servicePlugin: {
            className: 'OpdpTestPlugin',
            pyBody: '#test py body\nprint("hello")',
          },
        },
      ],
    },
  },

  {
    name: 'register-python-plugin-fresh-extension',
    whyMatters:
      'register_python_plugins production-proven first-write case — Form-level ' +
      'plugin on a brand-new extension. Catches F4 (LayoutInfos missing on fresh ext) ' +
      'by ensuring layoutInfoOid is wired through. Production scenario stable since Plan 5.',
    input: {
      extension: BASELINE_EXT,
      isNew: true,
      layoutInfoOid: 'fresh-ext-layout-oid',
      addPlugins: [
        {
          type: 'python',
          className: 'AfterConvertHandler',
          pyScript: '#after convert\npass',
        },
      ],
    },
  },

  {
    name: 'add-toolbar-button-form-level',
    whyMatters:
      'Lever 3 followup (2026-05-07) — addToolbarButton migrated from Route C ' +
      'overlay to Route B envelope rebuild via addBarButtons[]. This case ' +
      'locks the wire shape: BarButton lives in `<FormAppearance action="edit" ' +
      'oid={parent}>` overlay sibling to existingAppearancesRaw, with full ' +
      'BarDataManager/BarItems/BarItemLinks structure. Migrated wire equivalent ' +
      'of the deleted Route C `add-toolbar-button-form-level` case.',
    input: {
      extension: BASELINE_EXT,
      isNew: false,
      layoutInfoOid: 'L1',
      addBarButtons: [
        {
          appearanceOid: '22222222-3333-4444-5555-666666666666',
          appearanceKind: 'FormAppearance',
          appearanceElementType: 100,
          buttonKey: 'OpdpTestBtn',
          buttonId: '33333333333333333333333333333333',
          caption: '测试按钮',
          seq: 1,
          boundOperationKey: 'OpdpTest',
          boundOperationName: '测试操作',
          toolbarKey: 'tbToolBar',
          barDataManagerId: '44444444-5555-6666-7777-888888888888',
          formBusinessServiceId: '55555555-6666-7777-8888-999999999999',
          barItemLinkId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
        },
      ],
    },
  },

  {
    name: 'remove-toolbar-button-form-level',
    whyMatters:
      'Lever 3 followup (2026-05-07) — removeToolbarButton migrated from Route C ' +
      'overlay to Route B envelope rebuild via removeBarButtons[]. Locks the ' +
      'declarative remove markers wrapped in `<FormAppearance action="edit">`.',
    input: {
      extension: BASELINE_EXT,
      isNew: false,
      layoutInfoOid: 'L1',
      removeBarButtons: [
        {
          appearanceOid: '22222222-3333-4444-5555-666666666666',
          appearanceKind: 'FormAppearance',
          appearanceElementType: 100,
          buttonId: '33333333333333333333333333333333',
          barItemLinkId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
        },
      ],
    },
  },
];
