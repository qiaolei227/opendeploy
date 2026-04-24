import { describe, it, expect } from 'vitest';
import {
  buildDropSessionSQL,
  buildCreateSessionSQL,
  buildStartSessionSQL,
  buildStopSessionSQL,
  buildReadXelFileSQL
} from '../../../scripts/bos-recon/xe-session';

describe('xe-session SQL builders', () => {
  it('buildDropSessionSQL emits idempotent drop', () => {
    const sql = buildDropSessionSQL('opendeploy_bos_recon');
    expect(sql).toMatch(/IF EXISTS/i);
    expect(sql).toMatch(/DROP EVENT SESSION \[opendeploy_bos_recon\] ON SERVER/);
  });

  it('buildCreateSessionSQL includes statement_completed + actions + file target', () => {
    const sql = buildCreateSessionSQL({
      sessionName: 'opendeploy_bos_recon',
      xelPath: 'C:\\traces\\add-text-field.xel'
    });
    expect(sql).toMatch(/CREATE EVENT SESSION \[opendeploy_bos_recon\] ON SERVER/);
    expect(sql).toMatch(/sqlserver\.sp_statement_completed/);
    expect(sql).toMatch(/sqlserver\.sql_batch_completed/);
    expect(sql).toMatch(/sqlserver\.sql_text/);
    expect(sql).toMatch(/sqlserver\.client_app_name/);
    expect(sql).toMatch(/event_file/);
    // T-SQL 字面量无反斜杠转义 —— Windows 路径原样插入。
    expect(sql).toMatch(/C:\\traces\\add-text-field\.xel/);
  });

  it('buildReadXelFileSQL emits SELECT from fn_xe_file_target_read_file', () => {
    const sql = buildReadXelFileSQL('C:\\traces\\add-text-field.xel');
    expect(sql).toMatch(/SELECT CAST\(event_data AS xml\) AS event_xml/);
    expect(sql).toMatch(/sys\.fn_xe_file_target_read_file/);
    expect(sql).toMatch(/N'C:\\traces\\add-text-field\.xel'/);
    expect(sql).toMatch(/NULL, NULL, NULL/);
  });

  it('buildReadXelFileSQL rejects path with single quote', () => {
    expect(() => buildReadXelFileSQL("C:\\evil'; xp_cmdshell--")).toThrow(/invalid/i);
  });

  it('buildCreateSessionSQL omits filter WHERE when filterClientApp not provided (背景 trace 全抓)', () => {
    const sql = buildCreateSessionSQL({
      sessionName: 'opendeploy_bos_recon',
      xelPath: 'C:\\traces\\x.xel'
    });
    expect(sql).not.toMatch(/WHERE/i);
  });

  it('buildCreateSessionSQL adds WHERE client_app_name LIKE filter on BOTH events when filterClientApp provided', () => {
    const sql = buildCreateSessionSQL({
      sessionName: 'opendeploy_bos_recon',
      xelPath: 'C:\\traces\\x.xel',
      filterClientApp: '%Kingdee%'
    });
    // 两个 event 都要加 WHERE (否则一半事件还是全抓)
    expect(sql).toMatch(
      /sp_statement_completed[\s\S]*WHERE[\s\S]*client_app_name\s+LIKE\s+N'%Kingdee%'/
    );
    expect(sql).toMatch(
      /sql_batch_completed[\s\S]*WHERE[\s\S]*client_app_name\s+LIKE\s+N'%Kingdee%'/
    );
  });

  it('buildCreateSessionSQL rejects filterClientApp containing single-quote (T-SQL injection guard)', () => {
    expect(() =>
      buildCreateSessionSQL({
        sessionName: 'x',
        xelPath: 'C:\\traces\\x.xel',
        filterClientApp: "%'; DROP TABLE--"
      })
    ).toThrow(/invalid/i);
  });

  it('buildStartSessionSQL emits STATE=START', () => {
    const sql = buildStartSessionSQL('opendeploy_bos_recon');
    expect(sql).toMatch(
      /ALTER EVENT SESSION \[opendeploy_bos_recon\] ON SERVER STATE\s*=\s*START/
    );
  });

  it('buildStopSessionSQL emits STATE=STOP', () => {
    const sql = buildStopSessionSQL('opendeploy_bos_recon');
    expect(sql).toMatch(
      /ALTER EVENT SESSION \[opendeploy_bos_recon\] ON SERVER STATE\s*=\s*STOP/
    );
  });

  it('xelPath with single quote throws (prevent T-SQL injection)', () => {
    expect(() =>
      buildCreateSessionSQL({
        sessionName: 'x',
        xelPath: "C:\\evil'; DROP TABLE-- "
      })
    ).toThrow(/invalid/i);
  });
});
