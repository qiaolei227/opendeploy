/**
 * Extended Events session 的 T-SQL 生成器。
 *
 * Phase 1 策略 (由 spec §5.3 决定):
 *   - 不加 client_app_name filter (先看原始 trace 体积是否可接受)
 *   - target 用 event_file (.xel 持久化到磁盘, 不用 ring_buffer 以防丢事件)
 *   - 抓 sp_statement_completed + sql_batch_completed (BOS Designer 的语句
 *     大部分是 stored-proc 或 batched SQL)
 *   - actions: sql_text / session_id / client_app_name / database_name /
 *     tsql_stack (后 4 个用来在 diff 对账阶段区分多客户端)
 *
 * SQL 构造是纯函数 (可测),DB 执行由 cli.ts 驱动。
 */

export interface CreateSessionOptions {
  sessionName: string;
  xelPath: string;
}

/** 合法 xel 路径: Windows 路径 + 非引号字符。单引号会破坏 T-SQL 字符串。 */
function assertSafeXelPath(xelPath: string): void {
  if (/['\x00-\x1f]/.test(xelPath)) {
    throw new Error(`invalid xel path: must not contain quotes or control chars`);
  }
}

/** SQL Server identifier: 字母 + 数字 + 下划线。防止被当作表达式。 */
function assertSafeSessionName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`invalid session name: ${name}`);
  }
}

export function buildDropSessionSQL(sessionName: string): string {
  assertSafeSessionName(sessionName);
  return (
    `IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'${sessionName}')\n` +
    `  DROP EVENT SESSION [${sessionName}] ON SERVER;`
  );
}

export function buildCreateSessionSQL(opts: CreateSessionOptions): string {
  assertSafeSessionName(opts.sessionName);
  assertSafeXelPath(opts.xelPath);
  // T-SQL `N'...'` 字符串字面量没有反斜杠转义语义, 直接插入 Windows 路径即可。
  // `N'C:\traces\foo.xel'` 是正确的 T-SQL, 不是 `N'C:\\traces\\foo.xel'`。
  return [
    `CREATE EVENT SESSION [${opts.sessionName}] ON SERVER`,
    `ADD EVENT sqlserver.sp_statement_completed(`,
    `  ACTION(sqlserver.sql_text, sqlserver.session_id, sqlserver.client_app_name, sqlserver.database_name, sqlserver.tsql_stack)`,
    `),`,
    `ADD EVENT sqlserver.sql_batch_completed(`,
    `  ACTION(sqlserver.sql_text, sqlserver.session_id, sqlserver.client_app_name, sqlserver.database_name, sqlserver.tsql_stack)`,
    `)`,
    `ADD TARGET package0.event_file(SET filename = N'${opts.xelPath}', max_file_size = 50)`,
    `WITH (MAX_MEMORY = 4096 KB, EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS,`,
    `      MAX_DISPATCH_LATENCY = 5 SECONDS, STARTUP_STATE = OFF);`
  ].join('\n');
}

export function buildStartSessionSQL(sessionName: string): string {
  assertSafeSessionName(sessionName);
  return `ALTER EVENT SESSION [${sessionName}] ON SERVER STATE = START;`;
}

export function buildStopSessionSQL(sessionName: string): string {
  assertSafeSessionName(sessionName);
  return `ALTER EVENT SESSION [${sessionName}] ON SERVER STATE = STOP;`;
}

/**
 * `sys.fn_xe_file_target_read_file` 按 .xel 路径读出所有 event_data XML 行。
 * 传 NULL 给后 3 个 offset/bookmark 参数让 SQL Server 自己处理未 flush 的 buffer。
 */
export function buildReadXelFileSQL(xelPath: string): string {
  assertSafeXelPath(xelPath);
  return (
    `SELECT CAST(event_data AS xml) AS event_xml\n` +
    `  FROM sys.fn_xe_file_target_read_file(N'${xelPath}', NULL, NULL, NULL)`
  );
}
