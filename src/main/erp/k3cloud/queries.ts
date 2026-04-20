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
 * K/3 Cloud stores the full form metadata — fields included — as XML in
 * `T_META_OBJECTTYPE.FKERNELXML`. The XML tree is deep and carries a lot of
 * unrelated data (plugin registrations, validations, print templates).
 * Rather than shipping a full XML parser in Plan 4, we extract field
 * descriptors via a narrow regex over the standard element shapes K/3 Cloud
 * emits for fields:
 *
 *   <FooField Key="FCustomerId" ElementType="BasedataField" ...>
 *   <Field Key="FNumber" ElementType="TextField" ...>
 *
 * This catches most field definitions without paying the memory/CPU cost of
 * fully parsing a 1MB XML per object. When a form uses an uncommon shape the
 * field shows up with `type = 'Unknown'` — better to leak than to throw.
 *
 * Entry/detail context is inferred from the nearest preceding `<Entity
 * Key="...">` or `<SubEntity Key="...">` open tag — coarse but works for the
 * overwhelming majority of standard K/3 Cloud bills.
 */
const FIELD_OPEN_RE =
  /<(?:[A-Za-z]*Field|Field)\b[^>]*\bKey="([^"]+)"[^>]*\bElementType="([^"]*)"/g;
const ENTITY_OPEN_RE = /<(?:Entity|SubEntity|BillEntity|EntryEntity)\b[^>]*\bKey="([^"]+)"/g;

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

/** Exported for unit tests; production callers use getFields. */
export function parseFieldsFromKernelXml(xml: string): FieldMeta[] {
  // Collect entity openings with their positions so we can resolve the
  // enclosing entry for each field based on position ordering.
  const entityPositions: Array<{ pos: number; key: string }> = [];
  let em: RegExpExecArray | null;
  while ((em = ENTITY_OPEN_RE.exec(xml)) !== null) {
    entityPositions.push({ pos: em.index, key: em[1] });
  }
  ENTITY_OPEN_RE.lastIndex = 0;

  const fields: FieldMeta[] = [];
  const seen = new Set<string>();

  let fm: RegExpExecArray | null;
  while ((fm = FIELD_OPEN_RE.exec(xml)) !== null) {
    const key = fm[1];
    const type = fm[2] || 'Unknown';
    // Skip duplicates — K/3 Cloud sometimes redeclares a field in layout sections.
    if (seen.has(key)) continue;

    // Enclosing entry = closest entity opening that precedes this field.
    let entryKey: string | undefined;
    for (let i = entityPositions.length - 1; i >= 0; i--) {
      if (entityPositions[i].pos < fm.index) {
        entryKey = entityPositions[i].key;
        break;
      }
    }

    const meta: FieldMeta = {
      key,
      // Display name is also in the XML (usually a sibling `<Name><Item Key="LangName"...>` node);
      // resolving it reliably requires real XML parsing. Task 12.1 can follow up — for now fall
      // back to the field key so the agent has SOMETHING readable.
      name: key,
      type,
      isEntryField: entryKey !== undefined,
      entryKey
    };
    fields.push(meta);
    seen.add(key);
  }
  FIELD_OPEN_RE.lastIndex = 0;

  return fields;
}
