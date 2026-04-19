import { describe, it, expect } from 'vitest';
import zhCN from '../src/renderer/i18n/locales/zh-CN/common.json';
import enUS from '../src/renderer/i18n/locales/en-US/common.json';

describe('i18n locale files', () => {
  it('zh-CN and en-US have same top-level keys', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(enUS).sort());
  });

  it('zh-CN and en-US have same nested keys for each namespace', () => {
    for (const ns of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
      expect(Object.keys(zhCN[ns]).sort(), `namespace ${ns}`).toEqual(
        Object.keys((enUS as Record<string, object>)[ns]).sort()
      );
    }
  });

  it('all values are non-empty strings', () => {
    const collect = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const acc: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          if (v.trim() === '') acc.push(`${prefix}${k}`);
        } else if (typeof v === 'object' && v) {
          acc.push(...collect(v as Record<string, unknown>, `${prefix}${k}.`));
        }
      }
      return acc;
    };
    expect(collect(zhCN)).toEqual([]);
    expect(collect(enUS)).toEqual([]);
  });
});
