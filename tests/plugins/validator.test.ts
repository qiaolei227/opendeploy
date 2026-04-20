import { describe, expect, it } from 'vitest';
import { validatePluginFilename } from '../../src/main/plugins/validator';

describe('validatePluginFilename', () => {
  it('accepts a normal .py filename', () => {
    expect(validatePluginFilename('credit_limit_guard.py')).toEqual({ ok: true });
    expect(validatePluginFilename('A-b_0.py')).toEqual({ ok: true });
  });

  it('rejects non-string input', () => {
    expect(validatePluginFilename(undefined).ok).toBe(false);
    expect(validatePluginFilename(null).ok).toBe(false);
    expect(validatePluginFilename(123).ok).toBe(false);
  });

  it('rejects empty / whitespace-only', () => {
    expect(validatePluginFilename('').ok).toBe(false);
    expect(validatePluginFilename('   ').ok).toBe(false);
  });

  it('rejects non-.py extensions', () => {
    const r = validatePluginFilename('foo.cs');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\.py/);
  });

  it('rejects path separators', () => {
    expect(validatePluginFilename('a/b.py').ok).toBe(false);
    expect(validatePluginFilename('a\\b.py').ok).toBe(false);
  });

  it('rejects ".." traversal and leading dot', () => {
    expect(validatePluginFilename('../escape.py').ok).toBe(false);
    expect(validatePluginFilename('..foo.py').ok).toBe(false);
    expect(validatePluginFilename('.hidden.py').ok).toBe(false);
  });

  it('rejects names over 80 chars', () => {
    expect(validatePluginFilename('a'.repeat(78) + '.py').ok).toBe(false);
  });

  it('rejects non-ASCII chars', () => {
    expect(validatePluginFilename('信用额度.py').ok).toBe(false);
    expect(validatePluginFilename('foo bar.py').ok).toBe(false);
  });
});
