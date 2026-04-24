import { describe, it, expect } from 'vitest';
import { parseXelEventXml, normalizeEvents } from '../../../scripts/bos-recon/xe-parse';

/**
 * 一个真实 sp_statement_completed 事件的简化形态。
 * duration 单位微秒, timestamp ISO 8601。
 */
const FIXTURE_EVENT_XML = `
<event name="sp_statement_completed" package="sqlserver" timestamp="2026-04-24T15:00:01.123Z">
  <data name="duration"><value>4567</value></data>
  <data name="statement"><value>INSERT INTO T_META_FIELD (FID, FKEY) VALUES ('abc', 'F_TEST')</value></data>
  <action name="sql_text" package="sqlserver"><value>INSERT INTO T_META_FIELD (FID, FKEY) VALUES ('abc', 'F_TEST')</value></action>
  <action name="session_id" package="sqlserver"><value>57</value></action>
  <action name="client_app_name" package="sqlserver"><value>Kingdee.BOS.Designer</value></action>
  <action name="database_name" package="sqlserver"><value>AIS20260101</value></action>
</event>
`;

describe('parseXelEventXml', () => {
  it('extracts statement / duration / sessionId / clientApp / ts', () => {
    const ev = parseXelEventXml(FIXTURE_EVENT_XML);
    expect(ev).not.toBeNull();
    expect(ev!.name).toBe('sp_statement_completed');
    expect(ev!.stmt).toContain('INSERT INTO T_META_FIELD');
    expect(ev!.duration).toBe(4567);
    expect(ev!.sessionId).toBe('57');
    expect(ev!.clientApp).toBe('Kingdee.BOS.Designer');
    expect(ev!.database).toBe('AIS20260101');
    expect(ev!.timestamp).toBe('2026-04-24T15:00:01.123Z');
  });

  it('returns null for malformed xml', () => {
    expect(parseXelEventXml('<not-an-event>')).toBeNull();
  });

  it('handles XML-escaped SQL (quotes / <>)', () => {
    const xml = `
<event name="sql_batch_completed" package="sqlserver" timestamp="2026-04-24T15:00:02.000Z">
  <data name="batch_text"><value>SELECT &apos;a &lt; b&apos; FROM T_META_OBJECTTYPE WHERE FID = &quot;abc&quot;</value></data>
  <action name="session_id" package="sqlserver"><value>57</value></action>
</event>
`;
    const ev = parseXelEventXml(xml);
    expect(ev!.stmt).toBe(`SELECT 'a < b' FROM T_META_OBJECTTYPE WHERE FID = "abc"`);
  });
});

describe('normalizeEvents', () => {
  it('filters out our own recon SELECTs (reading sys.fn_xe_file_target_read_file)', () => {
    const events = [
      { name: 'sp_statement_completed', stmt: 'SELECT * FROM sys.fn_xe_file_target_read_file(N\'x\')', duration: 1, sessionId: '1', clientApp: null, database: null, timestamp: '' },
      { name: 'sp_statement_completed', stmt: 'INSERT INTO T_META_FIELD VALUES(...)', duration: 1, sessionId: '2', clientApp: 'BOS', database: 'AIS20260101', timestamp: '' }
    ];
    const cleaned = normalizeEvents(events);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].stmt).toContain('T_META_FIELD');
  });

  it('sorts events by timestamp ascending', () => {
    const events = [
      { name: 'x', stmt: 'B', duration: 1, sessionId: '1', clientApp: null, database: null, timestamp: '2026-04-24T15:00:02.000Z' },
      { name: 'x', stmt: 'A', duration: 1, sessionId: '1', clientApp: null, database: null, timestamp: '2026-04-24T15:00:01.000Z' }
    ];
    const sorted = normalizeEvents(events);
    expect(sorted.map((e) => e.stmt)).toEqual(['A', 'B']);
  });
});
