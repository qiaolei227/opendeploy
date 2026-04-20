import { describe, expect, it } from 'vitest';
import { validateQuery } from '../../src/main/erp/validator';

describe('validateQuery (MVP no-op)', () => {
  it('approves any input while the whitelist is unimplemented', () => {
    expect(validateQuery('SELECT 1')).toEqual({ ok: true });
    expect(validateQuery('SELECT FID, FNAME FROM T_META_OBJECTTYPE')).toEqual({ ok: true });
    // Today even a write would pass. The real whitelist (Plan 6 gate) must
    // tighten this; this test will flip to expect rejection at that point,
    // which is the intended signal that the red line is now enforced.
    expect(validateQuery('UPDATE T_SAL_OUTSTOCK SET FQTY = 0')).toEqual({ ok: true });
  });

  it('returns a stable shape (ok + optional reason)', () => {
    const result = validateQuery('SELECT 1');
    expect(result).toHaveProperty('ok');
    expect(typeof result.ok).toBe('boolean');
  });

  it('accepts an options object without throwing', () => {
    expect(() => validateQuery('SELECT 1', { devAllowUnsafe: true })).not.toThrow();
    expect(() => validateQuery('SELECT 1', {})).not.toThrow();
  });
});
