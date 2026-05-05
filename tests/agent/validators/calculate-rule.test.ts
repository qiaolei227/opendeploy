import { describe, it, expect } from 'vitest';
import { validateCalculateRule } from '../../../src/main/agent/validators/calculate-rule';

const SCHEMA = { fields: ['F金额', 'F数量', 'F单价', 'F税额', 'FCustId', 'FBillTypeID'] };

describe('calculate-rule validator', () => {
  it('passes valid IronPython assignment', () => {
    const result = validateCalculateRule(['F金额 = F数量 * F单价'], SCHEMA);
    expect(result.ok).toBe(true);
  });

  it('rejects SQL-style ROUND', () => {
    const result = validateCalculateRule(['F金额 = ROUND(F数量 * F单价, 2)'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/ROUND.*SQL.*Python.*round/);
  });

  it('rejects ISNULL', () => {
    const result = validateCalculateRule(['F金额 = ISNULL(F数量, 0)'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/ISNULL/);
  });

  it('rejects unknown field with suggestion', () => {
    const result = validateCalculateRule(['F金额 = F数量 * F單价'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].field).toBe('F單价');
    expect(result.errors![0].suggestions).toContain('F单价');
  });

  it('rejects unknown function with FuncDefine suggestion', () => {
    const result = validateCalculateRule(['F金额 = GetCurrentTime()'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/GetCurrentTime.*GetTime.*GetDate/);
  });

  it('rejects bare expression without =', () => {
    const result = validateCalculateRule(['F数量 * F单价'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/必须是赋值/);
  });

  it('rejects Python 3 print() function', () => {
    const result = validateCalculateRule(['F金额 = print(F数量)'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/print/);
  });

  it('accepts valid GetFieldValue', () => {
    const result = validateCalculateRule(['F金额 = GetFieldValue("F数量") * GetFieldValue("F单价")'], SCHEMA);
    expect(result.ok).toBe(true);
  });

  it('rejects GetFieldValue with unknown field key', () => {
    const result = validateCalculateRule(['F金额 = GetFieldValue("F幻觉字段")'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].field).toBe('F幻觉字段');
  });

  it('reports line number for multi-action arrays', () => {
    const result = validateCalculateRule([
      'F金额 = F数量 * F单价',
      'F税额 = ROUND(F金额 * 0.13, 2)',
    ], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors![0].line).toBe(2);
  });
});
