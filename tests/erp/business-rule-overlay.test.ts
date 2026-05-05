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
  type EntityServiceRuleArgs,
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
