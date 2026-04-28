/**
 * Parse the `<MetaData>` envelope returned by `GetBusinessObjectMetaData`.
 *
 * The K/3 Cloud server serializes a row of `T_META_OBJECTTYPE` (or any
 * other `T_META_*` table when called for sub-tables) into XML like:
 *
 *   <MetaData businessObjectId="SAL_SaleOrder" TableName="T_META_OBJECTTYPE">
 *     <TablePK>
 *       <Column Name="FID" Value="SAL_SaleOrder" Type="VARCHAR2" />
 *     </TablePK>
 *     <SQLData>
 *       <Comment>
 *         <FID>SAL_SaleOrder</FID>
 *         <FMODELTYPEID>100</FMODELTYPEID>
 *         <FBASEOBJECTID>SAL_BillTemplate</FBASEOBJECTID>
 *         ...
 *       </Comment>
 *     </SQLData>
 *     <XmlData ColName="FKERNELXML">
 *       <Comment>
 *         <FormMetadata> ...big FKERNELXML payload...
 *       </Comment>
 *     </XmlData>
 *   </MetaData>
 *
 * `<SQLData><Comment>` holds the row's scalar columns as direct-child
 * elements (one per column). `<XmlData ColName="...">` blocks each carry
 * one CLOB-style column verbatim.
 *
 * We expose two operations:
 *   - `parseMetaDataXml(xml)` — pulls scalar columns + each XmlData column
 *   - `unescapeXmlEntities(s)` — convert `&amp; / &lt; / &gt; / &quot; / &apos;`
 *     back to the underlying chars, since column values come pre-escaped.
 *
 * Once parsed, the `kernelXml` / `extension` strings can be fed directly
 * to the existing `parseFieldsFromKernelXml` / `parseFormPluginsFromKernelXml`
 * parsers in `queries.ts` — no rewrite needed.
 */

export interface ParsedMetaDataEnvelope {
  /** Object id surfaced by the server, e.g. "SAL_SaleOrder" or 32-hex extension FID. */
  objectId: string;
  /** Underlying table name, e.g. "T_META_OBJECTTYPE" or "T_META_OBJECTTYPE_L". */
  tableName: string;
  /**
   * Scalar columns from `<SQLData><Comment>`. Tag name is the column name
   * (e.g. `FID`, `FBASEOBJECTID`, `FSUPPLIERNAME`), value is the entity-decoded
   * inner text. Empty elements (`<FPASSWORD></FPASSWORD>`) become empty string.
   */
  columns: Record<string, string>;
  /**
   * Each `<XmlData ColName="X"><Comment>...</Comment></XmlData>` keyed by
   * the `ColName` attribute. Common keys: `FKERNELXML`, `FFCXML`, `FAUDITXML`.
   * Value is the raw inner XML, untrimmed (caller can trim if desired).
   */
  xmlColumns: Record<string, string>;
}

const ENTITY_RE = /&(amp|lt|gt|quot|apos);/g;

/** Reverse `&amp;` / `&lt;` / `&gt;` / `&quot;` / `&apos;` to their literals. */
export function unescapeXmlEntities(s: string): string {
  return s.replace(ENTITY_RE, (_, name) => {
    switch (name) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return _;
    }
  });
}

/**
 * Find the `<TAG ATTR>` opening tag and its matching `</TAG>` close, returning
 * the body slice between them. Handles nested same-name tags via depth count.
 * Returns null when not found.
 *
 * `tagName` MUST be a fixed tag (no regex metas). `searchFrom` lets the caller
 * skip past prior matches when stepping through multiple occurrences.
 */
function sliceElementBody(
  xml: string,
  tagName: string,
  searchFrom = 0,
): { body: string; openStart: number; openEnd: number; closeStart: number } | null {
  // Locate an opening tag — `<TagName>` or `<TagName ...>` (not `<TagNameSomething>`)
  const openRe = new RegExp(`<${tagName}(\\s[^>]*)?>`, 'g');
  openRe.lastIndex = searchFrom;
  const openMatch = openRe.exec(xml);
  if (!openMatch) return null;
  const openStart = openMatch.index;
  const openEnd = openMatch.index + openMatch[0].length;
  const closeStr = `</${tagName}>`;
  // Walk forward, counting nested opens of the same tag.
  const walkRe = new RegExp(`<\\/?${tagName}(\\s[^>]*)?>`, 'g');
  walkRe.lastIndex = openEnd;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = walkRe.exec(xml)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) {
        return { body: xml.slice(openEnd, m.index), openStart, openEnd, closeStart: m.index };
      }
    } else {
      depth++;
    }
  }
  // Open without close — malformed XML; treat the rest of doc as body.
  return { body: xml.slice(openEnd), openStart, openEnd, closeStart: xml.length - closeStr.length };
}

/**
 * Pull scalar key→value pairs from the body of `<SQLData><Comment>`.
 * Each direct-child element `<TAG>VALUE</TAG>` becomes one entry. Nested
 * elements are not expected here (the server only writes scalars), but if
 * they appear we fall through to taking the inner text verbatim.
 */
function parseScalarColumns(commentBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Match `<TAG>...</TAG>` pairs at any position. Values may contain entity
  // refs but no nested tags (server emits scalars only). Non-greedy on body.
  const re = /<([A-Z][A-Z0-9_]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(commentBody)) !== null) {
    out[m[1]] = unescapeXmlEntities(m[2]).trim();
  }
  // Self-closing form `<TAG />` — encode as empty string for symmetry.
  const selfRe = /<([A-Z][A-Z0-9_]*)\s*\/>/g;
  while ((m = selfRe.exec(commentBody)) !== null) {
    if (!(m[1] in out)) out[m[1]] = '';
  }
  return out;
}

/**
 * Parse one MetaData envelope.
 *
 * Throws when the document is missing the `<MetaData>` root or has no
 * `<SQLData><Comment>` block — those would be server-side bugs we want
 * to fail loud on rather than silently swallow.
 */
export function parseMetaDataXml(xml: string): ParsedMetaDataEnvelope {
  const trimmed = xml.trim();
  if (!trimmed) {
    throw new Error('parseMetaDataXml: empty input');
  }
  // Pull root attributes from the opening tag; cheaper than walking the whole doc.
  const rootMatch = /<MetaData\b([^>]*)>/.exec(trimmed);
  if (!rootMatch) {
    throw new Error('parseMetaDataXml: no <MetaData> root element');
  }
  const attrs = rootMatch[1];
  const objectId = /\bbusinessObjectId\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '';
  const tableName = /\bTableName\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '';

  // Scalar columns
  const sqlData = sliceElementBody(trimmed, 'SQLData');
  let columns: Record<string, string> = {};
  if (sqlData) {
    const comment = sliceElementBody(sqlData.body, 'Comment');
    if (comment) columns = parseScalarColumns(comment.body);
  }

  // XmlData blocks — there may be several (FKERNELXML, FFCXML, etc), keyed by ColName.
  const xmlColumns: Record<string, string> = {};
  let cursor = 0;
  while (true) {
    const block = sliceElementBody(trimmed, 'XmlData', cursor);
    if (!block) break;
    cursor = block.closeStart;
    const colNameMatch = /\bColName\s*=\s*"([^"]*)"/.exec(
      trimmed.slice(block.openStart, block.openEnd),
    );
    if (!colNameMatch) continue;
    const inner = sliceElementBody(block.body, 'Comment');
    xmlColumns[colNameMatch[1]] = inner ? inner.body.trim() : block.body.trim();
  }

  return { objectId, tableName, columns, xmlColumns };
}

/**
 * Convenience: parse + return just the FKERNELXML payload, or `''` if absent.
 * Most agent read-paths only need this column.
 */
export function extractKernelXml(xml: string): string {
  const env = parseMetaDataXml(xml);
  return env.xmlColumns['FKERNELXML'] ?? '';
}
