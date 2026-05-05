import { describe, it, expect } from 'vitest';
import { validateFieldExistence } from '../../../src/main/agent/validators/field-existence';

const SCHEMA = {
  fields: ['FBillNo', 'FCustId', 'FAmount', 'FQty', 'FPrice'],
};

describe('field-existence validator', () => {
  it('passes when all referenced fields exist', () => {
    const result = validateFieldExistence(['FAmount', 'FQty', 'FPrice'], SCHEMA);
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('passes on empty input', () => {
    expect(validateFieldExistence([], SCHEMA).ok).toBe(true);
  });

  it('rejects unknown field with suggestions', () => {
    const result = validateFieldExistence(['FCustomerId'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].field).toBe('FCustomerId');
    // FCustId is the closest by Levenshtein distance (distance 3 vs 6+ for others)
    expect(result.errors![0].suggestions).toEqual(
      expect.arrayContaining(['FCustId']),
    );
    // Suggestions list is bounded (top 3).
    expect(result.errors![0].suggestions.length).toBeLessThanOrEqual(3);
  });

  it('lists multiple missing fields with separate errors', () => {
    const result = validateFieldExistence(['FFoo', 'FBar', 'FAmount'], SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors!.map((e) => e.field)).toEqual(['FFoo', 'FBar']);
  });

  it('orders suggestions by Levenshtein distance (closest first)', () => {
    const result = validateFieldExistence(['FCust'], { fields: ['FCustId', 'FAmount', 'FQty'] });
    expect(result.ok).toBe(false);
    // FCustId differs by 2 chars, FQty by 3, FAmount by 5 — order matters.
    expect(result.errors![0].suggestions[0]).toBe('FCustId');
  });
});
