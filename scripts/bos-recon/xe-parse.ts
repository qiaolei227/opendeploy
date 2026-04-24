/**
 * 把 .xel 文件一行 event_data XML 解析成结构化 XeEvent,
 * 以及把一批事件做归一化 (过滤自己的 recon SELECT + 按时间排序)。
 *
 * 解析用正则抽取 —— event XML 结构固定,专门上 xml 库 (fast-xml-parser)
 * 是 YAGNI。和 bos-xml.ts 同风格 (它也是手写 tokenizer)。
 */

export interface XeEvent {
  /** 事件名 (sp_statement_completed / sql_batch_completed) */
  name: string;
  /** 实际 SQL 文本 (action=sql_text 或 data=statement / batch_text) */
  stmt: string;
  /** 微秒 */
  duration: number;
  sessionId: string;
  clientApp: string | null;
  database: string | null;
  /** event 属性里的 timestamp (ISO 8601) */
  timestamp: string;
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 从 XML 里抽 <data name="X">...<value>...</value>...</data> 或 <action> 同理。
 *
 * SQL Server 的 `CAST(event_data AS xml)` 对强类型列(duration=uint64 等)会
 * 在 <value> 前面序列化 <type name="..."/> 描述符:
 *   <data name="duration">
 *     <type name="uint64" package="package0"/>
 *     <value>4567</value>
 *   </data>
 * 所以匹配用 `[\s\S]*?` 懒匹配跳过任意中间子元素, 而不是只允许 `\s*`。
 */
function extractField(xml: string, tag: 'data' | 'action', name: string): string | null {
  const re = new RegExp(
    `<${tag}\\s+name="${name}"[^>]*>[\\s\\S]*?<value>([\\s\\S]*?)<\\/value>`,
    'i'
  );
  const m = xml.match(re);
  return m ? xmlUnescape(m[1]) : null;
}

/** 第一个非空字符串, 全都 null/空则返 ''。?? 不会在空字符串时 fallback, 这个函数会。 */
function firstNonEmpty(...xs: (string | null)[]): string {
  for (const x of xs) if (x !== null && x.trim() !== '') return x;
  return '';
}

export function parseXelEventXml(eventXml: string): XeEvent | null {
  const nameMatch = eventXml.match(/<event\s+name="([^"]+)"/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const tsMatch = eventXml.match(/<event[^>]+timestamp="([^"]+)"/);
  const timestamp = tsMatch ? tsMatch[1] : '';

  // statement 可能在 data (sp_statement_completed) 或 batch_text (sql_batch_completed)。
  // action=sql_text 有时覆盖完整语句。优先 action, fallback data 顺序;
  // firstNonEmpty 保证空字符串也会穿透到下一个候选(?? 只在 null 时穿透)。
  const stmt = firstNonEmpty(
    extractField(eventXml, 'action', 'sql_text'),
    extractField(eventXml, 'data', 'statement'),
    extractField(eventXml, 'data', 'batch_text')
  );

  const durationText = extractField(eventXml, 'data', 'duration');
  const duration = durationText ? Number(durationText) : 0;

  const sessionId = extractField(eventXml, 'action', 'session_id') ?? '';
  const clientApp = extractField(eventXml, 'action', 'client_app_name');
  const database = extractField(eventXml, 'action', 'database_name');

  return { name, stmt, duration, sessionId, clientApp, database, timestamp };
}

/**
 * - 过滤我们自己 recon scripts 发的 SQL (查 sys.fn_xe_file_target_read_file 的那条)
 * - 过滤空 stmt
 * - 按 timestamp 升序
 *
 * 不做 dedup (同一 INSERT 跑多次也全留, BOS Designer 偶尔会内部重发)。
 */
export function normalizeEvents(events: XeEvent[]): XeEvent[] {
  return events
    .filter((e) => e.stmt.trim() !== '')
    .filter((e) => !/sys\.fn_xe_file_target_read_file/i.test(e.stmt))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
