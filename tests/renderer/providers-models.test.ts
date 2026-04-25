import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_BY_ID, resolveActiveModel } from '../../src/renderer/data/providers';

describe('providers + models', () => {
  it('every provider declares models[] (Ollama may be empty)', () => {
    for (const p of PROVIDERS) {
      expect(p.models).toBeDefined();
      expect(Array.isArray(p.models)).toBe(true);
      if (p.id !== 'ollama') {
        expect(p.models.length).toBeGreaterThan(0);
        // recommended 标记在每家恰好一条
        expect(p.models.filter((m) => m.recommended).length).toBe(1);
      }
    }
  });

  it('every model has id / label / contextWindow / maxOutput / pricing / hint', () => {
    for (const p of PROVIDERS) {
      for (const m of p.models) {
        expect(m.id).toBeTruthy();
        expect(m.label).toBeTruthy();
        expect(m.contextWindow).toBeGreaterThan(0);
        expect(m.maxOutput).toBeGreaterThan(0);
        expect(m.pricing).toBeTruthy();
        expect(m.hint).toBeTruthy();
      }
    }
  });

  it('Ollama declares modelInputDefault', () => {
    const ollama = PROVIDER_BY_ID['ollama'];
    expect(ollama.models).toEqual([]);
    expect(ollama.modelInputDefault).toBeTruthy();
  });

  it('resolveActiveModel returns user choice when valid', () => {
    const m = resolveActiveModel('deepseek', { deepseek: 'deepseek-v4-pro' });
    expect(m?.id).toBe('deepseek-v4-pro');
  });

  it('resolveActiveModel falls back to recommended when stored id missing', () => {
    const m = resolveActiveModel('deepseek', { deepseek: 'no-such-model' });
    expect(m?.id).toBe('deepseek-v4-flash'); // recommended in our table
  });

  it('resolveActiveModel falls back to recommended when not stored at all', () => {
    const m = resolveActiveModel('claude', {});
    expect(m?.id).toBe('claude-haiku-4-5-20251001'); // recommended
  });

  it('resolveActiveModel for ollama returns null (用 modelInputDefault 走另一路径)', () => {
    const m = resolveActiveModel('ollama', {});
    expect(m).toBeNull();
  });

  it('resolveActiveModel returns null for unknown providerId', () => {
    const m = resolveActiveModel('does-not-exist', { 'does-not-exist': 'whatever' });
    expect(m).toBeNull();
  });
});
