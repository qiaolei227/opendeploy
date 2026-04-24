import { describe, it, expect } from 'vitest';
import {
  pickMatchingKeyColumn,
  pickKeyForTable,
  pickKeyForDiff,
  buildSnapshotSelectSQL,
  CANDIDATE_KEY_COLUMNS,
  NOISE_COLUMN_BLACKLIST,
  KNOWN_EXTENSION_LINK,
  COMPOSITE_KEY_TABLES,
  LIST_CANDIDATE_TABLES_SQL
} from '../../../scripts/bos-recon/snapshot-all';

describe('pickMatchingKeyColumn', () => {
  it('prefers FOBJECTTYPEID when table has it (扩展外键优先, 对新发现的 T_BAS/T_BOS 表这是正确 key)', () => {
    const col = pickMatchingKeyColumn(['FID', 'FOBJECTTYPEID', 'FMODIFYDATE']);
    expect(col).toBe('FOBJECTTYPEID');
  });

  it('falls back to FID when no FOBJECTTYPEID', () => {
    const col = pickMatchingKeyColumn(['FID', 'FNAME']);
    expect(col).toBe('FID');
  });

  it('returns null when table has no candidate key column', () => {
    const col = pickMatchingKeyColumn(['FFOO', 'FBAR']);
    expect(col).toBeNull();
  });

  it('exposes CANDIDATE_KEY_COLUMNS ordered by preference (FOBJECTTYPEID first)', () => {
    expect(CANDIDATE_KEY_COLUMNS[0]).toBe('FOBJECTTYPEID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FID');
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

describe('pickKeyForDiff (1:N 复合键选择)', () => {
  it('T_META_OBJECTTYPEREF 需 4 列复合键 (实证: 没 FID 列, 3 列唯一性不够 → 77 行里 2 对撞)', () => {
    // 实际列 (bos-recon add-text-field snapshot 实证): FOBJECTTYPEID /
    // FREFOBJECTTYPEID / FTABLENAME / FFIELDNAME, 无 FID。77 行全共享同一
    // FOBJECTTYPEID, 4 列组合才能唯一。
    const cols = ['FOBJECTTYPEID', 'FREFOBJECTTYPEID', 'FTABLENAME', 'FFIELDNAME'];
    expect(pickKeyForDiff('T_META_OBJECTTYPEREF', cols)).toEqual([
      'FOBJECTTYPEID',
      'FTABLENAME',
      'FFIELDNAME',
      'FREFOBJECTTYPEID'
    ]);
  });

  it('T_META_TRACKERBILLTABLE 用 [FOBJECTTYPEID, FTABLEID] 2 列 (FTABLEID 全局 int 唯一)', () => {
    const cols = ['FTABLEID', 'FTABLENAME', 'FPKFIELDNAME', 'FOBJECTTYPEID'];
    expect(pickKeyForDiff('T_META_TRACKERBILLTABLE', cols)).toEqual([
      'FOBJECTTYPEID',
      'FTABLEID'
    ]);
  });

  it('falls back to single key (FID) for 1:1 主表 T_META_OBJECTTYPE', () => {
    const cols = ['FID', 'FOBJECTTYPEID', 'FKERNELXML'];
    expect(pickKeyForDiff('T_META_OBJECTTYPE', cols)).toBe('FID');
  });

  it('falls back to pickKeyForTable for unknown tables', () => {
    const cols = ['FID', 'FSOMETHING'];
    expect(pickKeyForDiff('T_META_NEWLY_DISCOVERED', cols)).toBe('FID');
  });

  it('schema drift: 任一复合键列缺失时退回单外键 (FOBJECTTYPEID 仍比 null 强)', () => {
    // 如果 T_META_OBJECTTYPEREF 未来某列被移除, 至少退回单列外键,
    // 不要 silently 返回无效复合键。
    const cols = ['FOBJECTTYPEID', 'FREFOBJECTTYPEID']; // missing FTABLENAME + FFIELDNAME
    expect(pickKeyForDiff('T_META_OBJECTTYPEREF', cols)).toBe('FOBJECTTYPEID');
  });
});

describe('LIST_CANDIDATE_TABLES_SQL (snapshot 表发现)', () => {
  it('保留所有 T_META_* 表 (老行为, 主表 OBJECTTYPE/OBJECTTYPE_L 等没 FOBJECTTYPEID 也要扫)', () => {
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/LIKE\s+'T_META\[_\]%'/);
  });

  it('额外纳入 T_ 前缀且含 FOBJECTTYPEID 列的表 (扩表覆盖面: T_BAS_* / T_BOS_* 等)', () => {
    // 新发现机制: 除 T_META_* 外, 任何 T_ 前缀表只要有 FOBJECTTYPEID 列
    // 就是候选, 自动吃 BOS 把扩展关联扔到其他命名空间表的情况。
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/sys\.columns/i);
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/FOBJECTTYPEID/);
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/LIKE\s+'T\[_\]%'/);
  });

  it('按列类型预筛 GUID 兼容 (uniqueidentifier / varchar / nvarchar / char / nchar)', () => {
    // 业务表 (T_SAL_* 等) 的 FOBJECTTYPEID 常是 int, 查 GUID extId 必然 type
    // mismatch, 没必要进候选集污染 errorTables。按 system_type_id 预筛减少
    // per-table 查询失败噪音 (add-text-field P1 实测: 97 张 int 类型表被 筛掉)。
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/system_type_id/i);
  });

  it('使用 UNION / OR 组合两个来源 (T_META_* 集合 ∪ 含 FOBJECTTYPEID 集合)', () => {
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/UNION|OR/i);
  });

  it('结果按表名排序, 用 DISTINCT', () => {
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/ORDER BY/i);
    expect(LIST_CANDIDATE_TABLES_SQL).toMatch(/DISTINCT/i);
  });
});

describe('COMPOSITE_KEY_TABLES', () => {
  it('declares 1:N child tables that share foreign key across many rows', () => {
    expect(COMPOSITE_KEY_TABLES).toHaveProperty('T_META_OBJECTTYPEREF');
    expect(COMPOSITE_KEY_TABLES).toHaveProperty('T_META_TRACKERBILLTABLE');
  });

  it('每个条目至少 2 列 (外键 + 至少 1 内识别列)', () => {
    for (const [, composite] of Object.entries(COMPOSITE_KEY_TABLES)) {
      expect(Array.isArray(composite)).toBe(true);
      expect(composite.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('OBJECTTYPEREF 复合键包含必需列 (FOBJECTTYPEID + 字段级识别)', () => {
    const c = COMPOSITE_KEY_TABLES.T_META_OBJECTTYPEREF;
    expect(c).toContain('FOBJECTTYPEID');
    expect(c).toContain('FTABLENAME');
    expect(c).toContain('FFIELDNAME');
  });
});
