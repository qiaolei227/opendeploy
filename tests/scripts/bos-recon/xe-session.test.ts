import { describe, it, expect } from 'vitest';
import {
  buildDropSessionSQL,
  buildCreateSessionSQL,
  buildStartSessionSQL,
  buildStopSessionSQL
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
    expect(sql).toMatch(/C:\\\\traces\\\\add-text-field\.xel/);
  });

  it('buildCreateSessionSQL does NOT add client_app_name filter in Phase 1', () => {
    const sql = buildCreateSessionSQL({
      sessionName: 'opendeploy_bos_recon',
      xelPath: 'C:\\traces\\x.xel'
    });
    expect(sql).not.toMatch(/WHERE client_app_name/);
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
