import { describe, it, expect } from 'vitest';
import {
  pickMatchingKeyColumn,
  pickKeyForTable,
  buildSnapshotSelectSQL,
  CANDIDATE_KEY_COLUMNS,
  NOISE_COLUMN_BLACKLIST,
  KNOWN_EXTENSION_LINK
} from '../../../scripts/bos-recon/snapshot-all';

describe('pickMatchingKeyColumn', () => {
  it('prefers FID when table has it', () => {
    const col = pickMatchingKeyColumn(['FID', 'FOBJECTTYPEID', 'FMODIFYDATE']);
    expect(col).toBe('FID');
  });

  it('falls back to FOBJECTTYPEID when no FID', () => {
    const col = pickMatchingKeyColumn(['FOBJECTTYPEID', 'FNAME']);
    expect(col).toBe('FOBJECTTYPEID');
  });

  it('returns null when table has no candidate key column', () => {
    const col = pickMatchingKeyColumn(['FFOO', 'FBAR']);
    expect(col).toBeNull();
  });

  it('exposes CANDIDATE_KEY_COLUMNS ordered by preference', () => {
    expect(CANDIDATE_KEY_COLUMNS[0]).toBe('FID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FOBJECTTYPEID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FBILLFORMID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FENTRYID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FBASEOBJECTID');
  });
});

describe('buildSnapshotSelectSQL', () => {
  it('builds parameterized SELECT *', () => {
    const sql = buildSnapshotSelectSQL('T_META_FIELD', 'FID');
    expect(sql).toBe('SELECT * FROM T_META_FIELD WHERE FID = @v');
  });

  it('rejects unsafe table name (防 SQL 注入)', () => {
    expect(() => buildSnapshotSelectSQL("T_META; DROP TABLE X--", 'FID')).toThrow();
  });

  it('rejects unsafe column name', () => {
    expect(() => buildSnapshotSelectSQL('T_META_X', "FID; 1=1--")).toThrow();
  });
});

describe('NOISE_COLUMN_BLACKLIST', () => {
  it('excludes obvious audit cols that churn on every read', () => {
    expect(NOISE_COLUMN_BLACKLIST).toContain('FMODIFYDATE');
    expect(NOISE_COLUMN_BLACKLIST).toContain('FCREATEDATE');
  });
});

describe('pickKeyForTable', () => {
  it('uses KNOWN_EXTENSION_LINK override for tracker-style tables (FOBJECTTYPEID not FID)', () => {
    // T_META_TRACKERBILLTABLE 有 FID (行自己主键) 也有 FOBJECTTYPEID (指向扩展)。
    // 纯启发式会挑 FID → 查 extId 0 行, 漏掉 tracker 行。override 保证挑对列。
    const cols = ['FID', 'FOBJECTTYPEID', 'FTABLENAME', 'FTABLEID'];
    expect(pickKeyForTable('T_META_TRACKERBILLTABLE', cols)).toBe('FOBJECTTYPEID');
  });

  it('uses KNOWN_EXTENSION_LINK override for OBJECTTYPEREF (FOBJECTTYPEID)', () => {
    const cols = ['FID', 'FOBJECTTYPEID', 'FREFOBJECTTYPEID'];
    expect(pickKeyForTable('T_META_OBJECTTYPEREF', cols)).toBe('FOBJECTTYPEID');
  });

  it('uses KNOWN_EXTENSION_LINK for OBJECTTYPENAMEEX (FENTRYID, not FID)', () => {
    const cols = ['FENTRYID', 'FID'];
    expect(pickKeyForTable('T_META_OBJECTTYPENAMEEX', cols)).toBe('FENTRYID');
  });

  it('falls back to heuristic for unknown tables', () => {
    const cols = ['FID', 'FSOMETHING'];
    expect(pickKeyForTable('T_META_NEWLY_DISCOVERED', cols)).toBe('FID');
  });

  it('falls back when override column is absent (schema drift guard)', () => {
    // 如果 bos-backup.ts 说某表应该用 FOBJECTTYPEID 但该表 columns 里没有这列,
    // 就 fallback 到启发式, 防止 override 用了已不存在的列。
    expect(pickKeyForTable('T_META_TRACKERBILLTABLE', ['FID', 'FTABLEID'])).toBe('FID');
  });
});

describe('KNOWN_EXTENSION_LINK', () => {
  it('covers all 8 tables bos-backup.ts already stamps', () => {
    const expected = [
      'T_META_OBJECTTYPE',
      'T_META_OBJECTTYPE_L',
      'T_META_OBJECTTYPE_E',
      'T_META_OBJECTTYPENAMEEX',
      'T_META_OBJECTTYPENAMEEX_L',
      'T_META_OBJECTFUNCINTERFACE',
      'T_META_OBJECTTYPEREF',
      'T_META_TRACKERBILLTABLE'
    ];
    for (const t of expected) {
      expect(KNOWN_EXTENSION_LINK).toHaveProperty(t);
    }
  });
});
