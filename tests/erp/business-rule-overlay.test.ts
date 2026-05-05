/**
 * Pure string-op tests for the business-rule HeadEntity overlay templates.
 *
 * Path A (TS string-template overlay) — see Plan 5.12.3b Task 3.1
 * (`docs/plans/2026-05-04-plan-5.12.3b-business-rules-impl.md` lines
 * 528-570) and the spike that proved the wire shape:
 * `.scratch/probes/spike-bizrule-writeback.ts`.
 *
 * These helpers must compose deterministic XML — no GUID generation, no
 * server I/O — so we test against literal expected substrings.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAddEntityRuleOverlay,
  buildRemoveEntityRuleOverlay,
  injectOverlay,
  extractHeadEntityOid,
  buildFieldUpdateActionOverlay,
  inlineFieldUpdateActionInExt,
  extractFieldOid,
  type EntityServiceRuleArgs,
  type FieldUpdateActionService,
} from '../../src/main/erp/k3cloud/rpc/business-rule-overlay';

const PARENT_HEAD_OID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const RULE_ID = '11111111-1111-1111-1111-111111111111';
const SVC_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('buildAddEntityRuleOverlay', () => {
  it('emits HeadEntity overlay wrapping a GetInvStock service rule', () => {
    const args: EntityServiceRuleArgs = {
      ruleId: RULE_ID,
      description: 'GetInvStock 校验',
      preCondition: 'True',
      services: [
        {
          className: 'GetInvStockBusinessServiceMeta',
          actionId: 67,
          id: SVC_ID,
          description: '获取即时库存信息',
        },
      ],
    };
    const xml = buildAddEntityRuleOverlay(PARENT_HEAD_OID, args);

    // HeadEntity wrapper
    expect(xml).toContain(`<HeadEntity action="edit" oid="${PARENT_HEAD_OID}"`);
    expect(xml).toMatch(/<HeadEntity[^>]*ElementType="34"/);
    expect(xml).toContain('</HeadEntity>');

    // EntityServiceRules wrapper + the rule body (no remove attribute on add)
    expect(xml).toContain('<EntityServiceRules>');
    expect(xml).toContain('<EntityServiceRule>');
    expect(xml).toContain(`<Id>${RULE_ID}</Id>`);
    expect(xml).toContain('<Description>GetInvStock 校验</Description>');
    expect(xml).toContain('<PreCondition>True</PreCondition>');
    expect(xml).toContain('<Seq>1</Seq>');
    expect(xml).toContain('<WhenTrueBusinessServices>');
    expect(xml).toContain('<GetInvStockBusinessServiceMeta>');
    expect(xml).toContain('<ActionId>67</ActionId>');
    expect(xml).toContain(`<Id>${SVC_ID}</Id>`);
    expect(xml).toContain('</GetInvStockBusinessServiceMeta>');
    expect(xml).toContain('</WhenTrueBusinessServices>');
  });

  it('supports base FormBusinessService for entity-level Calculate (ActionId=2)', () => {
    const args: EntityServiceRuleArgs = {
      ruleId: RULE_ID,
      description: 'Calculate at entity level',
      preCondition: 'True',
      services: [
        {
          className: 'FormBusinessService',
          actionId: 2,
          id: SVC_ID,
        },
      ],
    };
    const xml = buildAddEntityRuleOverlay(PARENT_HEAD_OID, args);

    expect(xml).toContain('<FormBusinessService>');
    expect(xml).toContain('<ActionId>2</ActionId>');
    expect(xml).toContain('</FormBusinessService>');
    // No GetInvStock-specific tag emitted on the base path
    expect(xml).not.toContain('GetInvStockBusinessServiceMeta');
  });

  it('XML-escapes special characters in description / preCondition / properties', () => {
    const args: EntityServiceRuleArgs = {
      ruleId: RULE_ID,
      description: 'a < b & c > d',
      preCondition: 'this.Value > 0 && this.Other < "X"',
      services: [
        {
          className: 'GetInvStockBusinessServiceMeta',
          actionId: 67,
          id: SVC_ID,
          properties: { Note: 'a < b' },
        },
      ],
    };
    const xml = buildAddEntityRuleOverlay(PARENT_HEAD_OID, args);

    // Raw < / > / & must not survive verbatim inside text content.
    expect(xml).toContain('a &lt; b &amp; c &gt; d');
    expect(xml).toContain('&quot;X&quot;');
    expect(xml).toContain('<Note>a &lt; b</Note>');

    // Tag delimiters (the angle brackets we emit ourselves) must remain.
    expect(xml).toContain('<Description>');
    expect(xml).toContain('<PreCondition>');
  });

  it('supports optional preConditionDesc and arbitrary service properties', () => {
    const args: EntityServiceRuleArgs = {
      ruleId: RULE_ID,
      description: 'with extras',
      preCondition: 'True',
      preConditionDesc: '满足任意时',
      services: [
        {
          className: 'GetInvStockBusinessServiceMeta',
          actionId: 67,
          id: SVC_ID,
          properties: {
            StockQtyField: 'FStockQty',
            BaseUnitField: 'FBaseUnit',
          },
        },
      ],
    };
    const xml = buildAddEntityRuleOverlay(PARENT_HEAD_OID, args);

    expect(xml).toContain('<PreConditionDesc>满足任意时</PreConditionDesc>');
    expect(xml).toContain('<StockQtyField>FStockQty</StockQtyField>');
    expect(xml).toContain('<BaseUnitField>FBaseUnit</BaseUnitField>');
  });

  it('falls back to BOS-Designer-default service description when caller omits it (otherwise rule editor renders blank service row)', () => {
    // 2026-05-05 demo bug: GetInvStock rule appeared in BOS Designer's
    // "执行以下服务" list as a blank row — double-clicking showed all the
    // fields were intact. recon req-120 captured BOS Designer's own wire
    // shipping <Description>获取即时库存信息</Description> (per className)
    // even when the user never typed one. We mirror the default so the row
    // gets a visible label.
    const xmlGetInvStock = buildAddEntityRuleOverlay(PARENT_HEAD_OID, {
      ruleId: RULE_ID,
      description: 'rule label',
      preCondition: 'True',
      services: [
        { className: 'GetInvStockBusinessServiceMeta', actionId: 67, id: SVC_ID },
      ],
    });
    expect(xmlGetInvStock).toContain('<Description>获取即时库存信息</Description>');

    const xmlCalc = buildAddEntityRuleOverlay(PARENT_HEAD_OID, {
      ruleId: RULE_ID,
      description: 'rule label',
      preCondition: 'True',
      services: [{ className: 'FormBusinessService', actionId: 2, id: SVC_ID }],
    });
    expect(xmlCalc).toContain('<Description>计算定义公式的值并填写到指定列</Description>');
  });

  it('explicit service.description overrides the className default fallback', () => {
    const xml = buildAddEntityRuleOverlay(PARENT_HEAD_OID, {
      ruleId: RULE_ID,
      description: 'rule label',
      preCondition: 'True',
      services: [
        {
          className: 'GetInvStockBusinessServiceMeta',
          actionId: 67,
          id: SVC_ID,
          description: 'custom service label',
        },
      ],
    });
    expect(xml).toContain('<Description>custom service label</Description>');
    expect(xml).not.toContain('<Description>获取即时库存信息</Description>');
  });

  it('camelCase property keys are emitted as PascalCase wire elements (BOS server requires PascalCase or silently drops)', () => {
    const args: EntityServiceRuleArgs = {
      ruleId: RULE_ID,
      description: 'GetInvStock with camelCase props',
      preCondition: 'True',
      services: [
        {
          className: 'GetInvStockBusinessServiceMeta',
          actionId: 67,
          id: SVC_ID,
          properties: {
            stockQtyField: 'F_TestStock',
            availableQtyField: 'FAvbQty',
          },
        },
      ],
    };
    const xml = buildAddEntityRuleOverlay(PARENT_HEAD_OID, args);
    // Capitalized first letter; rest of name preserved.
    expect(xml).toContain('<StockQtyField>F_TestStock</StockQtyField>');
    expect(xml).toContain('<AvailableQtyField>FAvbQty</AvailableQtyField>');
    // Lowercase tag must NOT appear — that's the bug we just fixed.
    expect(xml).not.toContain('<stockQtyField>');
  });
});

describe('buildAddEntityRuleOverlay validation', () => {
  it('rejects empty parentHeadOid', () => {
    expect(() =>
      buildAddEntityRuleOverlay('', {
        ruleId: RULE_ID,
        description: 'x',
        preCondition: 'True',
        services: [{ className: 'FormBusinessService', actionId: 2, id: SVC_ID }],
      }),
    ).toThrow(/parentHeadOid is empty/);
  });

  it('rejects empty rule.ruleId', () => {
    expect(() =>
      buildAddEntityRuleOverlay(PARENT_HEAD_OID, {
        ruleId: '',
        description: 'x',
        preCondition: 'True',
        services: [{ className: 'FormBusinessService', actionId: 2, id: SVC_ID }],
      }),
    ).toThrow(/ruleId is empty/);
  });

  it('rejects service className that is not a valid BOS element name', () => {
    expect(() =>
      buildAddEntityRuleOverlay(PARENT_HEAD_OID, {
        ruleId: RULE_ID,
        description: 'x',
        preCondition: 'True',
        services: [{ className: 'Form Business Service', actionId: 2, id: SVC_ID }],
      }),
    ).toThrow(/not a valid BOS element name/);
  });

  it('rejects property name that is not a valid BOS element name', () => {
    expect(() =>
      buildAddEntityRuleOverlay(PARENT_HEAD_OID, {
        ruleId: RULE_ID,
        description: 'x',
        preCondition: 'True',
        services: [
          {
            className: 'GetInvStockBusinessServiceMeta',
            actionId: 67,
            id: SVC_ID,
            properties: { 'Bad<Name': 'v' },
          },
        ],
      }),
    ).toThrow(/not a valid BOS element name/);
  });
});

describe('buildRemoveEntityRuleOverlay', () => {
  it('emits HeadEntity wrapper with EntityServiceRule action="remove"', () => {
    const xml = buildRemoveEntityRuleOverlay(PARENT_HEAD_OID, RULE_ID);

    expect(xml).toContain(`<HeadEntity action="edit" oid="${PARENT_HEAD_OID}"`);
    expect(xml).toContain('<EntityServiceRules>');
    expect(xml).toContain(`<EntityServiceRule action="remove" oid="${RULE_ID}" />`);
    expect(xml).toContain('</EntityServiceRules>');
    expect(xml).toContain('</HeadEntity>');
    // The remove form is self-closing — must not contain a child <Id>.
    expect(xml).not.toMatch(new RegExp(`<EntityServiceRule[^/]*>\\s*<Id>${RULE_ID}</Id>`));
  });

  it('rejects empty parentHeadOid / ruleId', () => {
    expect(() => buildRemoveEntityRuleOverlay('', RULE_ID)).toThrow(/parentHeadOid is empty/);
    expect(() => buildRemoveEntityRuleOverlay(PARENT_HEAD_OID, '')).toThrow(/ruleId is empty/);
  });
});

describe('injectOverlay', () => {
  it('injects overlay text before the closing </Elements> tag', () => {
    const ext = '<Form><Elements><Form action="edit" oid="BOS_BillModel"></Form></Elements></Form>';
    const overlay = '<HeadEntity action="edit" oid="X"/>';
    const result = injectOverlay(ext, overlay);
    expect(result).toContain('<HeadEntity action="edit" oid="X"/></Elements>');
    expect(result).toContain(overlay);
    // Original prefix stays untouched
    expect(result.startsWith('<Form><Elements>')).toBe(true);
  });

  it('throws when </Elements> is not present', () => {
    expect(() => injectOverlay('<Form><Other></Other></Form>', '<HeadEntity/>')).toThrow(
      /<\/Elements>/,
    );
  });
});

describe('extractHeadEntityOid', () => {
  it('extracts the oid attribute from a HeadEntity tag', () => {
    const xml = '<Form><Elements><HeadEntity ElementType="34" oid="head-oid-1"><Foo/></HeadEntity></Elements></Form>';
    expect(extractHeadEntityOid(xml)).toBe('head-oid-1');
  });

  it('returns null when there is no HeadEntity tag', () => {
    const xml = '<Form><Elements><Form oid="X"/></Elements></Form>';
    expect(extractHeadEntityOid(xml)).toBeNull();
  });

  it('handles HeadEntity with attributes preceding oid', () => {
    const xml =
      '<Form><Elements><HeadEntity ElementType="34" ElementStyle="0" oid="head-oid-2"></HeadEntity></Elements></Form>';
    expect(extractHeadEntityOid(xml)).toBe('head-oid-2');
  });
});

// ─── Field-level UpdateAction overlay (Task 3.5) ────────────────────────

const FIELD_OID = 'fdcd6ab50b8b40e2ba8fe6166b14d8c9';
const SVC_DASHED_ID = 'afc25ea1-5732-4803-9f54-516a22fb0b09';

describe('buildFieldUpdateActionOverlay', () => {
  it('builds Calculate overlay for IntegerField with no disabledEvents', () => {
    const svc: FieldUpdateActionService = {
      actionId: 2,
      id: SVC_DASHED_ID,
      parameters: [' F_PAIJ_TestDecimal  =   F_PAIJ_TestInt '],
    };
    const xml = buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, svc);

    // Wrapper carries action="edit" + oid
    expect(xml.startsWith(`<IntegerField action="edit" oid="${FIELD_OID}">`)).toBe(true);
    expect(xml.endsWith('</IntegerField>')).toBe(true);

    // Bare FormBusinessService (no className subclass)
    expect(xml).toContain('<UpdateActions>');
    expect(xml).toContain('<FormBusinessService>');
    expect(xml).toContain('</FormBusinessService>');
    expect(xml).toContain('</UpdateActions>');

    // Parameters JSON-stringified, then XML-escaped (none needed here)
    expect(xml).toContain(
      '<Parameters>[" F_PAIJ_TestDecimal  =   F_PAIJ_TestInt "]</Parameters>',
    );

    // Default description used when caller omits
    expect(xml).toContain('<Description>计算定义公式的值并填写到指定列</Description>');
    expect(xml).toContain('<ActionId>2</ActionId>');
    expect(xml).toContain(`<Id>${SVC_DASHED_ID}</Id>`);

    // No Raise* elements when disabledEvents omitted
    expect(xml).not.toContain('<Raise');
  });

  it('builds overlay with 3 disabledEvents (matches recon req-120 shape)', () => {
    const svc: FieldUpdateActionService = {
      actionId: 2,
      id: SVC_DASHED_ID,
      parameters: ['F_X = F_Y * 2'],
      disabledEvents: ['ValueChanged', 'ItemReset', 'Reset'],
    };
    const xml = buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, svc);

    expect(xml).toContain('<RaiseValueChanged>DisableRaise</RaiseValueChanged>');
    expect(xml).toContain('<RaiseItemReset>DisableRaise</RaiseItemReset>');
    expect(xml).toContain('<RaiseReset>DisableRaise</RaiseReset>');
    // Order preservation matches caller order
    const idxV = xml.indexOf('<RaiseValueChanged>');
    const idxI = xml.indexOf('<RaiseItemReset>');
    const idxR = xml.indexOf('<RaiseReset>');
    expect(idxV).toBeGreaterThan(0);
    expect(idxI).toBeGreaterThan(idxV);
    expect(idxR).toBeGreaterThan(idxI);
  });

  it('uses caller-supplied description when provided', () => {
    const xml = buildFieldUpdateActionOverlay('TextField', FIELD_OID, {
      actionId: 2,
      id: SVC_DASHED_ID,
      parameters: ['F_X = "x"'],
      description: '自定义说明',
    });
    expect(xml).toContain('<Description>自定义说明</Description>');
    expect(xml).not.toContain('计算定义公式的值并填写到指定列');
  });

  it('XML-escapes parameters that contain quotes / angle brackets / ampersand', () => {
    const svc: FieldUpdateActionService = {
      actionId: 2,
      id: SVC_DASHED_ID,
      parameters: ['F_Result = "<x>" + F_A & F_B'],
    };
    const xml = buildFieldUpdateActionOverlay('TextField', FIELD_OID, svc);

    // JSON encodes "<x>" → \"<x>\" inside the JSON string; xmlEscape then turns
    // < → &lt;, > → &gt;, & → &amp;, " → &quot;.
    expect(xml).not.toMatch(/<Parameters>[^<]*<x>/); // raw < must not survive
    expect(xml).toContain('&lt;x&gt;');
    expect(xml).toContain('&amp;');
    // Tag delimiters we emit ourselves stay
    expect(xml).toContain('<Parameters>');
    expect(xml).toContain('</Parameters>');
  });

  it('XML-escapes description with metacharacters', () => {
    const xml = buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, {
      actionId: 2,
      id: SVC_DASHED_ID,
      parameters: ['F_X = 1'],
      description: 'a < b & c',
    });
    expect(xml).toContain('<Description>a &lt; b &amp; c</Description>');
  });

  it('rejects invalid fieldType (non-C-identifier shape)', () => {
    expect(() =>
      buildFieldUpdateActionOverlay('Bad Field', FIELD_OID, {
        actionId: 2,
        id: SVC_DASHED_ID,
        parameters: ['F_X = 1'],
      }),
    ).toThrow(/not a valid BOS element name/);
  });

  it('rejects empty fieldOid', () => {
    expect(() =>
      buildFieldUpdateActionOverlay('IntegerField', '', {
        actionId: 2,
        id: SVC_DASHED_ID,
        parameters: ['F_X = 1'],
      }),
    ).toThrow(/fieldOid is empty/);
  });

  it('rejects empty service.id', () => {
    expect(() =>
      buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, {
        actionId: 2,
        id: '',
        parameters: ['F_X = 1'],
      }),
    ).toThrow(/service\.id is empty/);
  });

  it('rejects empty parameters array', () => {
    expect(() =>
      buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, {
        actionId: 2,
        id: SVC_DASHED_ID,
        parameters: [],
      }),
    ).toThrow(/at least one IronPython assignment/);
  });

  it('rejects unknown event name in disabledEvents', () => {
    expect(() =>
      buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, {
        actionId: 2,
        id: SVC_DASHED_ID,
        parameters: ['F_X = 1'],
        disabledEvents: ['ValueChanged', 'NotAnEvent'],
      }),
    ).toThrow(/unknown Raise event 'NotAnEvent'/);
  });

  it('rejects invalid className', () => {
    expect(() =>
      buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, {
        actionId: 2,
        id: SVC_DASHED_ID,
        parameters: ['F_X = 1'],
        className: 'Bad Class',
      }),
    ).toThrow(/not a valid BOS element name/);
  });

  it('omits ClassName subclass when className not provided (uses bare FormBusinessService)', () => {
    const xml = buildFieldUpdateActionOverlay('IntegerField', FIELD_OID, {
      actionId: 2,
      id: SVC_DASHED_ID,
      parameters: ['F_X = 1'],
    });
    expect(xml).toContain('<FormBusinessService>');
    expect(xml).not.toContain('<ClassName>');
  });
});

describe('inlineFieldUpdateActionInExt', () => {
  // Realistic ext FKERNELXML shape — mirrors what k3cloud_add_fields emits
  // (per dcxml.ts:renderFieldElement) and what BOS server stores after
  // a successful Save. Inline path rewrites this in place.
  const EXT_FIELD_OID = '4e703fa5bcab45279b71029d3db17174';
  const EXT_KERNEL_XML =
    '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
    '<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">' +
    '<Id>extId</Id><Name>OpenDeploy demo</Name>' +
    '</Form>' +
    '<DecimalField ElementType="2" ElementStyle="0">' +
    '<ConditionType>0</ConditionType>' +
    '<FieldScale>2</FieldScale>' +
    '<FieldPrecision>23</FieldPrecision>' +
    '<PropertyName>F_TestQty</PropertyName>' +
    '<FieldName>F_TESTQTY</FieldName>' +
    '<ListTabIndex>9000</ListTabIndex>' +
    '<Name>数量</Name>' +
    `<Id>${EXT_FIELD_OID}</Id>` +
    '<Key>F_TestQty</Key>' +
    '</DecimalField>' +
    '</Elements></BusinessInfo></BusinessInfo></FormMetadata>';

  const SVC: FieldUpdateActionService = {
    actionId: 2,
    id: 'afc25ea1-5732-4803-9f54-516a22fb0b09',
    parameters: ['F_TestAmount = F_TestQty * F_TestPrice'],
    disabledEvents: ['ValueChanged', 'ItemReset', 'Reset'],
  };

  it('inserts FireUpdateEvent before PropertyName + UpdateActions after FieldName (capture req-120 ordering)', () => {
    const result = inlineFieldUpdateActionInExt(EXT_KERNEL_XML, 'DecimalField', EXT_FIELD_OID, SVC);
    // FireUpdateEvent immediately before <PropertyName>
    expect(result).toContain('<FieldPrecision>23</FieldPrecision><FireUpdateEvent>1</FireUpdateEvent><PropertyName>F_TestQty</PropertyName>');
    // UpdateActions immediately after </FieldName>
    expect(result).toContain('<FieldName>F_TESTQTY</FieldName><UpdateActions><FormBusinessService>');
    // Payload preserved
    expect(result).toContain('<Parameters>["F_TestAmount = F_TestQty * F_TestPrice"]</Parameters>');
    expect(result).toContain('<ActionId>2</ActionId>');
    expect(result).toContain('<RaiseValueChanged>DisableRaise</RaiseValueChanged>');
    expect(result).toContain('<Id>afc25ea1-5732-4803-9f54-516a22fb0b09</Id>');
    // Tail of field block intact (Name/Id/Key in original order, AFTER UpdateActions)
    expect(result).toContain('</UpdateActions><ListTabIndex>9000</ListTabIndex><Name>数量</Name>');
  });

  it('throws when the field block is missing in extension XML', () => {
    expect(() =>
      inlineFieldUpdateActionInExt(EXT_KERNEL_XML, 'DecimalField', 'wrong-oid-xx', SVC),
    ).toThrow(/not found in extension XML/);
  });

  it('throws when UpdateActions already present (v0.1: one Calculate per field)', () => {
    const xmlWithExisting = EXT_KERNEL_XML.replace(
      '<FieldName>F_TESTQTY</FieldName>',
      '<FieldName>F_TESTQTY</FieldName><UpdateActions><FormBusinessService><Id>x</Id></FormBusinessService></UpdateActions>',
    );
    expect(() =>
      inlineFieldUpdateActionInExt(xmlWithExisting, 'DecimalField', EXT_FIELD_OID, SVC),
    ).toThrow(/already has <UpdateActions>/);
  });

  it('does not re-emit FireUpdateEvent when already present (idempotent on that flag)', () => {
    const xmlWithFire = EXT_KERNEL_XML.replace(
      '<PropertyName>F_TestQty</PropertyName>',
      '<FireUpdateEvent>1</FireUpdateEvent><PropertyName>F_TestQty</PropertyName>',
    );
    const result = inlineFieldUpdateActionInExt(xmlWithFire, 'DecimalField', EXT_FIELD_OID, SVC);
    // Exactly one FireUpdateEvent, not two
    expect(result.match(/<FireUpdateEvent>1<\/FireUpdateEvent>/g)?.length).toBe(1);
    expect(result).toContain('<FieldName>F_TESTQTY</FieldName><UpdateActions>');
  });
});

describe('extractFieldOid', () => {
  it('finds field oid by Key match', () => {
    const xml =
      '<Form><Elements>' +
      '<IntegerField ElementType="3" ElementStyle="0">' +
      '<Name>测试整数</Name>' +
      '<Id>fdcd6ab50b8b40e2ba8fe6166b14d8c9</Id>' +
      '<Key>F_PAIJ_TestInt</Key>' +
      '</IntegerField>' +
      '</Elements></Form>';
    const result = extractFieldOid(xml, 'F_PAIJ_TestInt');
    expect(result).toEqual({
      oid: 'fdcd6ab50b8b40e2ba8fe6166b14d8c9',
      fieldType: 'IntegerField',
    });
  });

  it('returns null when field key is not found', () => {
    const xml =
      '<Form><Elements>' +
      '<TextField><Name>x</Name><Id>oid1</Id><Key>FX</Key></TextField>' +
      '</Elements></Form>';
    expect(extractFieldOid(xml, 'FNotThere')).toBeNull();
  });

  it('handles multiple fields in same XML — returns the matching one', () => {
    const xml =
      '<Form><Elements>' +
      '<TextField ElementType="1"><Name>A</Name><Id>oid-text-A</Id><Key>FA</Key></TextField>' +
      '<DecimalField ElementType="11"><Name>B</Name><Id>oid-dec-B</Id><Key>FB</Key></DecimalField>' +
      '<IntegerField ElementType="3"><Name>C</Name><Id>oid-int-C</Id><Key>FC</Key></IntegerField>' +
      '</Elements></Form>';
    expect(extractFieldOid(xml, 'FA')).toEqual({ oid: 'oid-text-A', fieldType: 'TextField' });
    expect(extractFieldOid(xml, 'FB')).toEqual({ oid: 'oid-dec-B', fieldType: 'DecimalField' });
    expect(extractFieldOid(xml, 'FC')).toEqual({ oid: 'oid-int-C', fieldType: 'IntegerField' });
  });

  it('picks the last (top-level) Id when nested RefProperty Ids are present', () => {
    // Real BOS field XML often has nested <RefProperty><Id>...</Id></RefProperty>
    // before the field's own top-level <Id>. We pick the LAST Id to align
    // with parseFieldsFromKernelXml's findLastTopLevelChildText('Id') discipline.
    const xml =
      '<Elements>' +
      '<BaseDataField ElementType="13">' +
      '<RefProperty><Id>nested-ref-id</Id></RefProperty>' +
      '<Name>客户</Name>' +
      '<Id>field-own-id</Id>' +
      '<Key>FCustomerId</Key>' +
      '</BaseDataField>' +
      '</Elements>';
    expect(extractFieldOid(xml, 'FCustomerId')).toEqual({
      oid: 'field-own-id',
      fieldType: 'BaseDataField',
    });
  });

  it('returns null when input is empty', () => {
    expect(extractFieldOid('', 'FX')).toBeNull();
    expect(extractFieldOid('<Elements/>', '')).toBeNull();
  });

  it('extractFieldOid does not match Key inside nested <RefProperty>', () => {
    const xml =
      '<Form><Elements>' +
      '<TextField>' +
      '<RefProperty><Key>FOther</Key><Id>nested-id</Id></RefProperty>' +
      '<Name>name</Name>' +
      '<Id>id-of-A</Id>' +
      '<Key>FA</Key>' +
      '</TextField>' +
      '<TextField>' +
      '<Name>nameOther</Name>' +
      '<Id>id-of-Other</Id>' +
      '<Key>FOther</Key>' +
      '</TextField>' +
      '</Elements></Form>';
    // Look up FOther — must find the SECOND field (id-of-Other), NOT the first.
    expect(extractFieldOid(xml, 'FOther')).toEqual({ oid: 'id-of-Other', fieldType: 'TextField' });
    // Look up FA — must find the first field, ignoring its nested RefProperty key.
    expect(extractFieldOid(xml, 'FA')).toEqual({ oid: 'id-of-A', fieldType: 'TextField' });
  });
});
