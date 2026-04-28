import { describe, expect, it } from 'vitest';
import { buildEnumSaveAp0 } from '../../../src/main/erp/k3cloud/rpc/save-enum-object';

describe('buildEnumSaveAp0', () => {
  it('produces a JSON object with the EnumObject schema header + caller data', () => {
    const ap0 = buildEnumSaveAp0({
      name: 'TEST_ENUM',
      enumTypeId: '11111111-1111-1111-1111-111111111111',
      items: [
        { value: 'A', caption: '甲', enumItemId: '22222222-2222-2222-2222-222222222222' },
        { value: 'B', caption: '乙', enumItemId: '33333333-3333-3333-3333-333333333333' },
      ],
    });
    const obj = JSON.parse(ap0);
    expect(obj.$$DynamicObjectType).toBeDefined();
    expect(obj.$$DynamicObjectType.Name).toBe('EnumObject');
    expect(obj.Id).toBe('11111111-1111-1111-1111-111111111111');
    expect(obj.Name).toEqual([{ Key: 2052, Value: 'TEST_ENUM' }]);
    expect(obj.Category).toBe(0);
    expect(obj.IsSysPreset).toBe('0');
  });

  it('renders each enum item with EnumId / Value / Caption / Seq', () => {
    const ap0 = buildEnumSaveAp0({
      name: 'X',
      items: [
        { value: 'YES', caption: '是', enumItemId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        { value: 'NO', caption: '否', enumItemId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      ],
    });
    const obj = JSON.parse(ap0);
    expect(obj.Items).toHaveLength(2);
    expect(obj.Items[0]).toMatchObject({
      EnumId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      Value: 'YES',
      Seq: 0,
      Invalid: false,
      IsSysPreSet: false,
    });
    expect(obj.Items[0].Caption).toEqual([{ Key: 2052, Value: '是' }]);
    expect(obj.Items[1]).toMatchObject({
      EnumId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      Value: 'NO',
      Seq: 1,
    });
  });

  it('preserves agent-supplied seq', () => {
    const ap0 = buildEnumSaveAp0({
      name: 'X',
      items: [
        { value: 'A', caption: '甲', seq: 100 },
        { value: 'B', caption: '乙', seq: 200 },
      ],
    });
    const obj = JSON.parse(ap0);
    expect(obj.Items[0].Seq).toBe(100);
    expect(obj.Items[1].Seq).toBe(200);
  });

  it('emits MultiLanguageText with the lcid + display strings', () => {
    const ap0 = buildEnumSaveAp0({
      name: 'TEST',
      items: [{ value: 'A', caption: '甲' }],
    });
    const obj = JSON.parse(ap0);
    expect(obj.MultiLanguageText).toHaveLength(1);
    expect(obj.MultiLanguageText[0]).toMatchObject({
      LocaleId: 2052,
      Name: 'TEST',
      '$$FromDatabase': false,
    });
    expect(obj.Items[0].MultiLanguageText[0]).toMatchObject({
      LocaleId: 2052,
      Caption: '甲',
    });
  });

  it('marks all rows new (DirtyFlags + FromDatabase=false) for fresh inserts', () => {
    const ap0 = buildEnumSaveAp0({
      name: 'X',
      items: [{ value: 'A', caption: '甲' }],
    });
    const obj = JSON.parse(ap0);
    expect(obj['$$FromDatabase']).toBe(false);
    expect(obj['$$DirtyFlags']).toBe('17');
    expect(obj.Items[0]['$$FromDatabase']).toBe(false);
    expect(obj.Items[0]['$$DirtyFlags']).toBe('3');
  });

  it('auto-generates GUIDs when caller omits enumTypeId / enumItemId', () => {
    const ap0 = buildEnumSaveAp0({
      name: 'X',
      items: [{ value: 'A', caption: '甲' }, { value: 'B', caption: '乙' }],
    });
    const obj = JSON.parse(ap0);
    // Standard 8-4-4-4-12 GUIDs
    expect(obj.Id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(obj.Items[0].EnumId).toMatch(/^[a-f0-9]{8}-/);
    expect(obj.Items[1].EnumId).toMatch(/^[a-f0-9]{8}-/);
    // Item GUIDs should be distinct.
    expect(obj.Items[0].EnumId).not.toBe(obj.Items[1].EnumId);
  });
});
