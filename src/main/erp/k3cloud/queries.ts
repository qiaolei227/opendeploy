/**
 * Typed-query SQL + parsers for K/3 Cloud metadata. Kept separate from the
 * connector class so the SQL text is in one file (easy to audit for the
 * white-list that lands in Plan 6) and the class stays readable.
 *
 * All queries MUST:
 * - use `request.input(name, type, value)` — never string-concat user input
 * - call `validateQuery()` before `.query()` (caller's responsibility)
 * - target only `T_META_*` tables + their `_L` localization siblings
 */

import sql from 'mssql';
import type {
  FieldMeta,
  ObjectMeta,
  SubsystemMeta
} from '@shared/erp-types';
import type { ListObjectsOptions } from '../types';
import { validateQuery } from '../validator';

const DEFAULT_LOCALE = 2052; // zh-CN
const DEFAULT_LIMIT = 200;

/** Guard: calls validator and throws if it rejects the query. */
function requireValid(sqlText: string): void {
  const r = validateQuery(sqlText);
  if (!r.ok) throw new Error(`SQL validator rejected query: ${r.reason ?? 'no reason given'}`);
}

function rowToObjectMeta(row: Record<string, unknown>): ObjectMeta {
  const modifyDate = row.FMODIFYDATE;
  return {
    id: String(row.FID),
    name: String(row.FNAME ?? row.FID ?? ''),
    modelTypeId: row.FMODELTYPEID == null ? null : Number(row.FMODELTYPEID),
    subsystemId: row.FSUBSYSID == null ? null : String(row.FSUBSYSID),
    isTemplate: Number(row.FISTEMPLATE ?? 0) === 1,
    modifyDate:
      modifyDate instanceof Date
        ? modifyDate.toISOString()
        : modifyDate == null
          ? null
          : String(modifyDate)
  };
}

// ─── listObjects ────────────────────────────────────────────────────────

const LIST_OBJECTS_SQL = `
  SELECT o.FID,
         COALESCE(ol.FNAME, o.FID) AS FNAME,
         o.FMODELTYPEID,
         o.FSUBSYSID,
         o.FISTEMPLATE,
         o.FMODIFYDATE
    FROM T_META_OBJECTTYPE o
    LEFT JOIN T_META_OBJECTTYPE_L ol
           ON o.FID = ol.FID AND ol.FLOCALEID = @locale
   WHERE (@includeTemplates = 1 OR o.FISTEMPLATE = 0)
     AND (@keyword IS NULL OR o.FID LIKE @kw OR ol.FNAME LIKE @kw)
     AND (@subsystemId IS NULL OR o.FSUBSYSID = @subsystemId)
   ORDER BY ol.FNAME, o.FID
   OFFSET 0 ROWS FETCH NEXT @lim ROWS ONLY
`;

export async function listObjects(
  pool: sql.ConnectionPool,
  opts: ListObjectsOptions = {}
): Promise<ObjectMeta[]> {
  requireValid(LIST_OBJECTS_SQL);
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const keyword = opts.keyword?.trim() ? opts.keyword.trim() : null;
  const kw = keyword ? `%${keyword}%` : null;
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 1000);

  const result = await pool
    .request()
    .input('locale', sql.Int, locale)
    .input('includeTemplates', sql.Bit, opts.includeTemplates ? 1 : 0)
    .input('keyword', sql.NVarChar(256), keyword)
    .input('kw', sql.NVarChar(258), kw)
    .input('subsystemId', sql.VarChar(36), opts.subsystemId ?? null)
    .input('lim', sql.Int, limit)
    .query<Record<string, unknown>>(LIST_OBJECTS_SQL);

  return result.recordset.map(rowToObjectMeta);
}

// ─── getObject ──────────────────────────────────────────────────────────

const GET_OBJECT_SQL = `
  SELECT o.FID,
         COALESCE(ol.FNAME, o.FID) AS FNAME,
         o.FMODELTYPEID,
         o.FSUBSYSID,
         o.FISTEMPLATE,
         o.FMODIFYDATE
    FROM T_META_OBJECTTYPE o
    LEFT JOIN T_META_OBJECTTYPE_L ol
           ON o.FID = ol.FID AND ol.FLOCALEID = @locale
   WHERE o.FID = @id
`;

export async function getObject(
  pool: sql.ConnectionPool,
  id: string,
  locale: number = DEFAULT_LOCALE
): Promise<ObjectMeta | null> {
  requireValid(GET_OBJECT_SQL);
  const result = await pool
    .request()
    .input('locale', sql.Int, locale)
    .input('id', sql.VarChar(36), id)
    .query<Record<string, unknown>>(GET_OBJECT_SQL);
  const row = result.recordset[0];
  return row ? rowToObjectMeta(row) : null;
}

// ─── listSubsystems ────────────────────────────────────────────────────

const LIST_SUBSYSTEMS_SQL = `
  SELECT s.FID,
         s.FNUMBER,
         COALESCE(sl.FNAME, s.FNUMBER) AS FNAME
    FROM T_META_SUBSYSTEM s
    LEFT JOIN T_META_SUBSYSTEM_L sl
           ON s.FID = sl.FID AND sl.FLOCALEID = @locale
   WHERE s.FVISIBLE = 1 OR s.FVISIBLE IS NULL
   ORDER BY s.FSEQ, s.FNUMBER
`;

export async function listSubsystems(
  pool: sql.ConnectionPool,
  locale: number = DEFAULT_LOCALE
): Promise<SubsystemMeta[]> {
  requireValid(LIST_SUBSYSTEMS_SQL);
  const result = await pool
    .request()
    .input('locale', sql.Int, locale)
    .query<{ FID: string; FNUMBER: string; FNAME: string }>(LIST_SUBSYSTEMS_SQL);
  return result.recordset.map((r) => ({
    id: r.FID,
    number: r.FNUMBER,
    name: r.FNAME
  }));
}

// ─── searchMetadata ────────────────────────────────────────────────────
// Alias of listObjects with a required keyword and lower default limit.

export async function searchMetadata(
  pool: sql.ConnectionPool,
  keyword: string,
  locale: number = DEFAULT_LOCALE
): Promise<ObjectMeta[]> {
  return listObjects(pool, { keyword, locale, limit: 50, includeTemplates: false });
}

// ─── getFields (XML parse) ─────────────────────────────────────────────

const GET_FIELDS_SQL = `
  SELECT CAST(o.FKERNELXML AS nvarchar(max)) AS xml
    FROM T_META_OBJECTTYPE o
   WHERE o.FID = @id
`;

/**
 * K/3 Cloud stores full form metadata — fields, plugins, layout, validations —
 * as a single FKERNELXML blob in `T_META_OBJECTTYPE`. Unlike the attribute-
 * style one might expect, K/3 Cloud declares each field's identity via CHILD
 * elements, while the field's *type* is the tag name itself. Critically, all
 * real fields are listed FLAT at the top level of `<Elements>` — entry
 * affiliation is declared via a direct-child `<EntityKey>` on the field node,
 * NOT by nesting inside an `<EntryEntity>` tag. (EntryEntity nodes exist but
 * only carry entry-level metadata — table name, seq, key field — not the
 * field declarations themselves.)
 *
 *   <BaseDataField ElementType="13" ElementStyle="0">
 *     ...deep nested metadata (some of which ALSO contain <Key> tags, e.g.
 *        inside <RefProperty><Key>FOtherField</Key></RefProperty>) ...
 *     <EntityKey>FSaleOrderEntry</EntityKey>  ← entry affiliation (absent → head)
 *     <Name>物料编码</Name>                   ← localized display name
 *     <Id>uuid…</Id>
 *     <Key>FMaterialId</Key>                 ← field key
 *   </BaseDataField>
 *
 * We walk the XML with a streaming tag tokenizer and an element-depth stack
 * so that, when a field node closes, we can slice its body and pull only the
 * top-level <Key> / <Name> / <EntityKey> — the ones at depth 0 within the
 * node, avoiding the many nested same-named tags that belong to sub-structs.
 * Fields lacking a direct-child <Name> are treated as pseudo-field metadata
 * markers (e.g. internal tags like `<QKFField>` that happen to end in
 * "Field") and skipped — they would otherwise clutter the output with unnamed
 * entries and, due to first-wins dedup, steal the slot from the real field.
 *
 * Shipping a full DOM parser would be overkill (SAL_SaleOrder alone ships
 * ~1 MB of kernel XML) and a flat attribute regex misses K/3 Cloud's real
 * shape entirely.
 */
const FIELD_TAG_RE = /Field$/;
/**
 * Source pattern for the tag tokenizer. Compiled to a FRESH `RegExp` each
 * time `iterateTagTokens` is called — the parser nests tokenizer iterations
 * (the outer walk invokes `findLastTopLevelChildText` on each field body),
 * so sharing a `/g` regex across calls would corrupt `lastIndex`.
 */
const TAG_TOKEN_PATTERN = '<(\\/?)([A-Za-z][A-Za-z0-9]*)\\b[^>]*?(\\/?)>';

export async function getFields(
  pool: sql.ConnectionPool,
  formId: string,
  _locale: number = DEFAULT_LOCALE
): Promise<FieldMeta[]> {
  requireValid(GET_FIELDS_SQL);
  const result = await pool
    .request()
    .input('id', sql.VarChar(36), formId)
    .query<{ xml: string | null }>(GET_FIELDS_SQL);
  const xml = result.recordset[0]?.xml;
  if (!xml) return [];
  return parseFieldsFromKernelXml(xml);
}

interface TagToken {
  tag: string;
  isClose: boolean;
  isSelfClose: boolean;
  start: number;
  end: number;
}

function* iterateTagTokens(xml: string): Generator<TagToken> {
  const re = new RegExp(TAG_TOKEN_PATTERN, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    yield {
      tag: m[2],
      isClose: m[1] === '/',
      isSelfClose: m[3] === '/',
      start: m.index,
      end: m.index + m[0].length
    };
  }
}

/**
 * Return the text inside the LAST `<tagName>...</tagName>` that sits at depth
 * 0 of `body` (i.e., a direct child, not nested inside another element).
 * Returns undefined when no such child exists.
 */
function findLastTopLevelChildText(body: string, tagName: string): string | undefined {
  let depth = 0;
  let lastStart = -1;
  let lastEnd = -1;
  for (const tk of iterateTagTokens(body)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      if (depth === 0 && tk.tag === tagName) lastStart = tk.end;
      depth++;
    } else {
      depth--;
      if (depth === 0 && tk.tag === tagName && lastStart >= 0) lastEnd = tk.start;
    }
  }
  if (lastStart >= 0 && lastEnd > lastStart) {
    return body.substring(lastStart, lastEnd).trim() || undefined;
  }
  return undefined;
}

type Frame =
  | { kind: 'plain'; tag: string }
  | { kind: 'field'; tag: string; bodyStart: number };

/** Exported for unit tests; production callers use getFields. */
export function parseFieldsFromKernelXml(xml: string): FieldMeta[] {
  const fields: FieldMeta[] = [];
  const seen = new Set<string>();
  const stack: Frame[] = [];

  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;

    if (!tk.isClose) {
      if (FIELD_TAG_RE.test(tk.tag)) {
        stack.push({ kind: 'field', tag: tk.tag, bodyStart: tk.end });
      } else {
        stack.push({ kind: 'plain', tag: tk.tag });
      }
      continue;
    }

    // Close token: pop tolerantly (malformed XML shouldn't abort the parse).
    const frame = stack.pop();
    if (!frame || frame.kind !== 'field') continue;

    const body = xml.substring(frame.bodyStart, tk.start);
    // Require both Key and Name — a Field-shaped tag with no Name is an
    // internal marker (QKFField, etc.), not a UI field.
    const key = findLastTopLevelChildText(body, 'Key');
    if (!key || seen.has(key)) continue;
    const name = findLastTopLevelChildText(body, 'Name');
    if (!name) continue;
    const entityKey = findLastTopLevelChildText(body, 'EntityKey');

    seen.add(key);
    fields.push({
      key,
      name,
      type: frame.tag,
      isEntryField: entityKey !== undefined,
      entryKey: entityKey
    });
  }

  return fields;
}
