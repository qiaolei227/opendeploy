/**
 * Tests for the pure-TS business-rule list parser. Replaces the
 * bridge-backed ListBusinessRules path that couldn't see HeadEntity overlays
 * (BOS DcxmlSerializer drops `action="edit"` delta markers when no baseline
 * is loaded). 2026-05-05 demo scenario 3 root cause.
 */

import { describe, expect, it } from 'vitest';
import { parseBusinessRules } from '../../../src/main/erp/k3cloud/rpc/business-rule-parser';

describe('parseBusinessRules — entity-level rules', () => {
  it('finds GetInvStock rule inside HeadEntity overlay (action="edit" delta marker)', () => {
    // Mirrors the wire shape we ship via SaveForIDEV9 + how it lands in
    // T_META_OBJECTTYPE.FKERNELXML after the server merges the overlay.
    const xml =
      '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
      '<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">' +
      '<Id>extId</Id><Name>demo</Name>' +
      '</Form>' +
      '<HeadEntity action="edit" oid="be8f270b-6aab-446a-9e11-7fcc39084958" ElementType="34" ElementStyle="0">' +
      '<EntityServiceRules>' +
      '<EntityServiceRule>' +
      '<Id>9803482e-c165-429d-964f-78178b399077</Id>' +
      '<Description>标准销售订单查可用库存</Description>' +
      "<PreCondition>FBillTypeID.FNumber == '01.01'</PreCondition>" +
      '<PreConditionDesc>仅标准销售订单</PreConditionDesc>' +
      '<Seq>1</Seq>' +
      '<WhenTrueBusinessServices>' +
      '<GetInvStockBusinessServiceMeta>' +
      '<ActionId>67</ActionId>' +
      '<StockQtyField>F_TestStock</StockQtyField>' +
      '<Id>d2c818b559aa470b9b994f5a7fece527</Id>' +
      '</GetInvStockBusinessServiceMeta>' +
      '</WhenTrueBusinessServices>' +
      '</EntityServiceRule>' +
      '</EntityServiceRules>' +
      '</HeadEntity>' +
      '</Elements></BusinessInfo></BusinessInfo></FormMetadata>';

    const r = parseBusinessRules(xml);
    expect(r.entityRules).toHaveLength(1);
    expect(r.entityRules[0]).toMatchObject({
      ruleId: '9803482e-c165-429d-964f-78178b399077',
      preCondition: "FBillTypeID.FNumber == '01.01'",
      preConditionDesc: '仅标准销售订单',
      description: '标准销售订单查可用库存',
      seq: 1,
    });
    expect(r.entityRules[0].services).toEqual([
      {
        branch: 'WhenTrueBusinessServices',
        actionId: 67,
        className: 'GetInvStockBusinessServiceMeta',
        serviceId: 'd2c818b559aa470b9b994f5a7fece527',
      },
    ]);
  });

  it('finds multiple entity rules inside same HeadEntity (post-add accumulation)', () => {
    const xml =
      '<HeadEntity action="edit" oid="abc">' +
      '<EntityServiceRules>' +
      '<EntityServiceRule><Id>r1</Id><PreCondition>True</PreCondition><Seq>1</Seq>' +
      '<WhenTrueBusinessServices><GetInvStockBusinessServiceMeta><ActionId>67</ActionId><Id>s1</Id></GetInvStockBusinessServiceMeta></WhenTrueBusinessServices>' +
      '</EntityServiceRule>' +
      '<EntityServiceRule><Id>r2</Id><PreCondition>True</PreCondition><Seq>2</Seq>' +
      '<WhenTrueBusinessServices><FormBusinessService><ActionId>2</ActionId><Id>s2</Id></FormBusinessService></WhenTrueBusinessServices>' +
      '</EntityServiceRule>' +
      '</EntityServiceRules>' +
      '</HeadEntity>';
    const r = parseBusinessRules(xml);
    expect(r.entityRules.map((er) => er.ruleId)).toEqual(['r1', 'r2']);
    expect(r.entityRules[0].services[0].actionId).toBe(67);
    expect(r.entityRules[1].services[0].actionId).toBe(2);
  });

  it('returns empty arrays when extension XML has no rules', () => {
    const xml =
      '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
      '<Form action="edit" oid="BOS_BillModel"><Id>x</Id></Form>' +
      '</Elements></BusinessInfo></BusinessInfo></FormMetadata>';
    const r = parseBusinessRules(xml);
    expect(r.entityRules).toEqual([]);
    expect(r.fieldUpdateActions).toEqual([]);
  });
});

describe('parseBusinessRules — field-level UpdateActions', () => {
  it('finds inline UpdateActions in extension self-defined field block', () => {
    // Inline shape: extension's own field with FireUpdateEvent +
    // UpdateActions emitted *inside* the field body (capture req-120).
    const xml =
      '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
      '<DecimalField ElementType="2" ElementStyle="0">' +
      '<ConditionType>0</ConditionType>' +
      '<FireUpdateEvent>1</FireUpdateEvent>' +
      '<PropertyName>F_TestQty</PropertyName>' +
      '<FieldName>F_TESTQTY</FieldName>' +
      '<UpdateActions>' +
      '<FormBusinessService>' +
      '<Parameters>["F_TestAmount = F_TestQty * F_TestPrice"]</Parameters>' +
      '<ActionId>2</ActionId>' +
      '<Id>ba26fec8-17f3-42a3-bcb3-629082687f7a</Id>' +
      '</FormBusinessService>' +
      '</UpdateActions>' +
      '<Name>数量</Name>' +
      '<Id>4e703fa5</Id>' +
      '<Key>F_TestQty</Key>' +
      '</DecimalField>' +
      '</Elements></BusinessInfo></BusinessInfo></FormMetadata>';

    const r = parseBusinessRules(xml);
    expect(r.fieldUpdateActions).toEqual([
      {
        fieldKey: 'F_TestQty',
        actionId: 2,
        className: 'FormBusinessService',
        serviceId: 'ba26fec8-17f3-42a3-bcb3-629082687f7a',
        parameters: '["F_TestAmount = F_TestQty * F_TestPrice"]',
      },
    ]);
  });

  it('finds UpdateActions in <XField action="edit"> overlay (parent-original field path)', () => {
    // Overlay shape: parent field referenced via action=edit + oid; the
    // <Key> doesn't appear in this overlay (lives in parent's FKERNELXML).
    const xml =
      '<Elements>' +
      '<IntegerField action="edit" oid="parent-int-oid">' +
      '<UpdateActions>' +
      '<FormBusinessService>' +
      '<Parameters>[" FOther = FInt * 2 "]</Parameters>' +
      '<ActionId>2</ActionId>' +
      '<Id>afc25ea1-5732-4803-9f54-516a22fb0b09</Id>' +
      '</FormBusinessService>' +
      '</UpdateActions>' +
      '</IntegerField>' +
      '</Elements>';

    const r = parseBusinessRules(xml);
    expect(r.fieldUpdateActions).toHaveLength(1);
    expect(r.fieldUpdateActions[0]).toMatchObject({
      fieldKey: '', // overlay has no <Key> child
      actionId: 2,
      className: 'FormBusinessService',
      serviceId: 'afc25ea1-5732-4803-9f54-516a22fb0b09',
    });
  });

  it('finds both inline and overlay UpdateActions in same FKERNELXML', () => {
    const xml =
      '<Elements>' +
      '<DecimalField ElementType="2"><FieldName>FX</FieldName>' +
      '<UpdateActions><FormBusinessService><ActionId>2</ActionId><Id>inline-svc</Id></FormBusinessService></UpdateActions>' +
      '<Key>F_Inline</Key></DecimalField>' +
      '<IntegerField action="edit" oid="parent-x">' +
      '<UpdateActions><FormBusinessService><ActionId>2</ActionId><Id>overlay-svc</Id></FormBusinessService></UpdateActions>' +
      '</IntegerField>' +
      '</Elements>';
    const r = parseBusinessRules(xml);
    expect(r.fieldUpdateActions.map((a) => a.serviceId)).toEqual(['inline-svc', 'overlay-svc']);
    expect(r.fieldUpdateActions[0].fieldKey).toBe('F_Inline');
    expect(r.fieldUpdateActions[1].fieldKey).toBe('');
  });

  it('does not surface fields that have no UpdateActions', () => {
    const xml =
      '<Elements>' +
      '<TextField><Name>x</Name><Id>oid</Id><Key>F_NoActions</Key></TextField>' +
      '</Elements>';
    const r = parseBusinessRules(xml);
    expect(r.fieldUpdateActions).toEqual([]);
  });
});

describe('parseBusinessRules — combined real-shape XML', () => {
  it('handles 2 entity rules + 2 inline UpdateActions in one FKERNELXML (matches scenario 1+3 final state)', () => {
    const xml =
      '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
      '<Form action="edit" oid="BOS_BillModel"><Id>extId</Id></Form>' +
      '<HeadEntity action="edit" oid="head-oid">' +
      '<EntityServiceRules>' +
      '<EntityServiceRule><Id>old-rule</Id><PreCondition>True</PreCondition>' +
      '<WhenTrueBusinessServices><GetInvStockBusinessServiceMeta><ActionId>67</ActionId><Id>old-svc</Id></GetInvStockBusinessServiceMeta></WhenTrueBusinessServices>' +
      '</EntityServiceRule>' +
      '<EntityServiceRule><Id>new-rule</Id><PreCondition>True</PreCondition>' +
      '<WhenTrueBusinessServices><GetInvStockBusinessServiceMeta><ActionId>67</ActionId><StockQtyField>F_TestStock</StockQtyField><Id>new-svc</Id></GetInvStockBusinessServiceMeta></WhenTrueBusinessServices>' +
      '</EntityServiceRule>' +
      '</EntityServiceRules>' +
      '</HeadEntity>' +
      '<DecimalField ElementType="2"><FieldName>F_TESTQTY</FieldName>' +
      '<UpdateActions><FormBusinessService><ActionId>2</ActionId><Id>qty-svc</Id></FormBusinessService></UpdateActions>' +
      '<Key>F_TestQty</Key></DecimalField>' +
      '<DecimalField ElementType="2"><FieldName>F_TESTPRICE</FieldName>' +
      '<UpdateActions><FormBusinessService><ActionId>2</ActionId><Id>price-svc</Id></FormBusinessService></UpdateActions>' +
      '<Key>F_TestPrice</Key></DecimalField>' +
      '</Elements></BusinessInfo></BusinessInfo></FormMetadata>';
    const r = parseBusinessRules(xml);
    expect(r.entityRules.map((er) => er.ruleId)).toEqual(['old-rule', 'new-rule']);
    expect(r.fieldUpdateActions.map((a) => a.fieldKey)).toEqual(['F_TestQty', 'F_TestPrice']);
  });
});
