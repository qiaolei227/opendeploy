import { describe, it, expect } from 'vitest';
import { extractCallsAndFields, parseAssignment } from '../../../src/main/agent/validators/ironpython-ast';

describe('ironpython-ast extraction', () => {
  it('extracts function calls', () => {
    const result = extractCallsAndFields('round(F金额 * 1.13, 2)');
    expect(result.functions).toEqual(['round']);
    expect(result.fields).toEqual(['F金额']);
  });

  it('extracts dotted field access', () => {
    const result = extractCallsAndFields('FCustId.FNumber == "VIP"');
    expect(result.fields).toEqual(['FCustId', 'FCustId.FNumber']);
  });

  it('extracts GetFieldValue calls', () => {
    const result = extractCallsAndFields('GetFieldValue("FQty") * GetFieldValue("FPrice")');
    expect(result.functions).toEqual(['GetFieldValue']);
    expect(result.fieldStringRefs).toEqual(['FQty', 'FPrice']);
  });

  it('parses simple assignment', () => {
    const result = parseAssignment('F金额 = F数量 * F单价');
    expect(result.ok).toBe(true);
    expect(result.target).toBe('F金额');
    expect(result.expression).toBe('F数量 * F单价');
  });

  it('rejects bare expression (no =)', () => {
    const result = parseAssignment('F数量 * F单价');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/必须是赋值/);
  });

  it('handles whitespace-padded assignments', () => {
    const result = parseAssignment('  F金额  =  F数量 * F单价  ');
    expect(result.ok).toBe(true);
    expect(result.target).toBe('F金额');
  });
});
