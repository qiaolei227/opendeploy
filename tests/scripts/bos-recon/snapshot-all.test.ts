import { describe, it, expect } from 'vitest';
import {
  pickMatchingKeyColumn,
  buildSnapshotSelectSQL,
  CANDIDATE_KEY_COLUMNS,
  NOISE_COLUMN_BLACKLIST
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
