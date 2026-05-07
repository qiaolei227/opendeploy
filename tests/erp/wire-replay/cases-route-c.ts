/**
 * Route C (overlay — frozen) wire-replay fixtures.
 *
 * Route C is dying (lever 3 will collapse it into Route B). These snapshots
 * lock the current overlay shape so the lever-3 migration can be done
 * incrementally — any in-place edit that drifts the overlay output gets
 * caught here, and the migration PR removes both the overlay AND the case
 * together.
 *
 * No new cases should be added here. New write capabilities go through
 * Route A or Route B. See docs/architecture/bos-write-routes.md §3 Route C.
 */

import {
  buildAddCustomOperationOverlay,
  type AddCustomOperationArgs,
  buildRemoveOperationOverlay,
  buildAddToolbarButtonOverlay,
  type AddToolbarButtonArgs,
  buildRemoveToolbarButtonOverlay,
} from '../../../src/main/erp/k3cloud/rpc/operation-overlay';

export interface RouteCCase {
  name: string;
  whyMatters: string;
  /** Pure function that produces the overlay XML. */
  produce: () => string;
}

export const ROUTE_C_CASES: RouteCCase[] = [
  {
    name: 'add-custom-operation-with-plugin',
    whyMatters:
      'Frozen — Route C addCustomOperation was abandoned by 5.12.6 hotfix #4 ' +
      '(switched to Route B saveExtension). Snapshot prevents silent drift while ' +
      'the function is still exported. Lever 3 deletes both case + function.',
    produce: () =>
      buildAddCustomOperationOverlay({
        extensionFormId: '00000000000000000000000000000001',
        operationKey: 'OpdpTest',
        operationName: '测试操作',
        operationParameterId: '11111111-2222-3333-4444-555555555555',
        operationId: 45,
        pluginClassName: 'OpdpTestPlugin',
        pyBody: '#test\nprint(1)',
      } satisfies AddCustomOperationArgs),
  },

  {
    name: 'remove-operation',
    whyMatters:
      'Currently in production use (5.12.6 connector.removeOperation). Frozen ' +
      'until lever 3 migrates remove* to Route B (removeFormOperations: [key] ' +
      'on SaveExtensionRequest).',
    produce: () => buildRemoveOperationOverlay('OpdpTest'),
  },

  {
    name: 'add-toolbar-button-form-level',
    whyMatters:
      'Frozen — Route C addToolbarButton was paired with addCustomOperation; ' +
      'both abandoned post-hotfix #4. Lever 3 deletes both.',
    produce: () =>
      buildAddToolbarButtonOverlay({
        extensionFormId: '00000000000000000000000000000001',
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
      } satisfies AddToolbarButtonArgs),
  },

  {
    name: 'remove-toolbar-button',
    whyMatters:
      'Currently in production use (5.12.6 connector.removeToolbarButton). ' +
      'Frozen until lever 3 migrates remove* to Route B.',
    produce: () =>
      buildRemoveToolbarButtonOverlay(
        'FormAppearance',
        '22222222-3333-4444-5555-666666666666',
        100,
        '33333333333333333333333333333333',
        '66666666-7777-8888-9999-aaaaaaaaaaaa',
      ),
  },
];
