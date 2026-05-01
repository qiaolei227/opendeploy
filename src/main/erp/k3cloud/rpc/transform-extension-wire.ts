/**
 * Post-process the bridge's patched XML into the wire shape BOS Designer
 * itself produces when modifying a convert-rule extension.
 *
 * Why this exists: `buildPatchBaseXml` keeps a full skeleton of every Policy
 * node so the .NET bridge's `FindDefaultConvertPolicy` / `RequirePolicy<T>`
 * can locate mount points. That skeleton then survives into the wire we send
 * to the server, which records every Policy as "extension declares this
 * Policy with no overrides". BOS Designer in turn renders the extension's
 * empty declarations side-by-side with the parent's inherited Policies,
 * which the user sees as duplicated entries (关联主单据体, 单据类型映射, …
 * each appearing twice).
 *
 * Empirical wire shape (capture #1354 — BOS Designer's own modify save on
 * an extension of SaleOrder-ReturnSaleOrder):
 *
 *   <ConvertRule …>
 *     <Status action="reset" />
 *     <Policies>
 *       <DefaultConvertPolicy action="edit" oid="<parent-Policy-oid>" …>
 *         <FieldMaps>
 *           <FieldMap action="edit" oid="<parent-FieldMap-oid>" …>
 *             <SourceFieldKey>FDate</SourceFieldKey>
 *           </FieldMap>
 *           <FieldMap …>            ← newly-added FieldMap, no action attr
 *             <TargetFieldKey>F_PAIJ_TestText</TargetFieldKey>
 *             …
 *           </FieldMap>
 *           …
 *         </FieldMaps>
 *       </DefaultConvertPolicy>
 *     </Policies>
 *     <Id>…</Id><Key>…</Key>
 *   </ConvertRule>
 *
 * Three rules:
 *   1. `<Status action="reset" />` — extension status falls back to parent.
 *   2. Only Policies that contain instance content (FieldMap / PlugIn /
 *      LinkEntity / BillTypeMap / Filter / GroupColumnInfo / FormBusiness /
 *      TailDiff) are emitted; bare skeletons are stripped.
 *   3. Each surviving Policy gets `action="edit"` + `oid="<parent-oid>"`
 *      (the oid is the parent rule's own Policy id, which we look up from
 *      the parent rule's full XML). Newly-added inner elements (FieldMaps,
 *      PlugIns, etc.) carry no `action` — the server treats absent action
 *      as add. Edited inner elements carry `action="edit" oid="<parent-id>"`
 *      but our patch ops never edit inherited inner elements (we only add),
 *      so we don't synthesize those here.
 */

/**
 * Top-level Policy element names we know how to handle. Names not in this
 * list pass through unchanged; this protects against accidentally munging
 * unfamiliar Policy types added by future K/3 versions.
 */
const TOP_LEVEL_POLICY_NAMES: ReadonlyArray<string> = [
  'DefaultConvertPolicy',
  'ConvertGroupByPolicy',
  'ConvertFilterPolicy',
  'ConvertSortPolicy',
  'ConvertOrderByPolicy',
  'ConvertPlugInPolicy',
  'ConvertFormBusinessPolicy',
  'ConvertAttachmentPolicy',
  'ConvertTailDiffPolicy',
  'LinkEntityPolicy',
  'BillTypeMapPolicy',
];

/**
 * Element names whose presence inside a Policy's inner XML indicates real
 * instance content (vs. just a structural skeleton with empty self-closing
 * collections like `<FieldMaps />`). Matches both `<Name ` and `<Name>` forms.
 */
const POLICY_CONTENT_ELEMENTS: ReadonlyArray<string> = [
  'FieldMap',
  'PlugIn',
  'LinkEntity',
  'BillTypeMap',
  'Filter',
  'GroupColumnInfo',
  'FormBusinessService',
  'TailDiff',
];

/** Single regex compiled from POLICY_CONTENT_ELEMENTS — `<(Name1|Name2|…)[ >]`. */
const POLICY_CONTENT_RE = new RegExp(
  `<(?:${POLICY_CONTENT_ELEMENTS.join('|')})[ >]`,
);

/** Match one top-level Policy node and capture its name, attrs, inner XML. */
const POLICY_NODE_RE = /<(\w+Policy)\s+([^>]*?)>([\s\S]*?)<\/\1>/g;

export interface TransformExtensionWireArgs {
  /** XML returned by the .NET bridge after applying patch ops. */
  patchedXml: string;
  /** Parent rule's full XML — used to look up each Policy's oid. */
  originXml: string;
}

/**
 * Build a Map of `ElementType` (string, as it appears in the XML) → Policy
 * oid (the Policy's own `<Id>` child element, which is always the *last*
 * `<Id>` inside the Policy's inner XML — preceding `<Id>`s belong to nested
 * elements like FieldMaps).
 */
export function parsePolicyOidMap(originXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = new RegExp(POLICY_NODE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(originXml))) {
    const name = m[1];
    if (!TOP_LEVEL_POLICY_NAMES.includes(name)) continue;
    const etMatch = /ElementType="(\d+)"/.exec(m[2]);
    if (!etMatch) continue;
    const ids = [...m[3].matchAll(/<Id>([^<]+)<\/Id>/g)];
    if (ids.length === 0) continue;
    map.set(etMatch[1], ids[ids.length - 1][1]);
  }
  return map;
}

/**
 * Convert the bridge's patched XML into the BOS Designer-compatible
 * extension-modify wire. Idempotent: running this on already-transformed
 * XML re-applies the same edits without producing duplicate `action`
 * attributes (the regex anchors on the Policy open tag and replaces
 * wholesale).
 */
export function transformPatchedToExtensionWire(
  args: TransformExtensionWireArgs,
): string {
  const { patchedXml, originXml } = args;
  const oidByElementType = parsePolicyOidMap(originXml);

  let xml = patchedXml;

  // (1) <Status …> → <Status action="reset" />. The bridge typically emits
  // either `<Status>True</Status>` or `<Status />`; either becomes the
  // reset sentinel. Idempotent on already-transformed input.
  xml = xml.replace(
    /<Status(?:\s+action="reset")?\s*(?:\/|>(?:True|False|)<\/Status)>/,
    '<Status action="reset" />',
  );

  // (2)+(3) Process each top-level Policy node. Strip those whose inner XML
  // carries no instance content; for the rest, inject action="edit" + oid.
  xml = xml.replace(
    new RegExp(POLICY_NODE_RE.source, 'g'),
    (full, name: string, attrs: string, inner: string) => {
      if (!TOP_LEVEL_POLICY_NAMES.includes(name)) return full;
      if (!POLICY_CONTENT_RE.test(inner)) return ''; // strip empty skeleton

      const etMatch = /ElementType="(\d+)"/.exec(attrs);
      const oid = etMatch ? oidByElementType.get(etMatch[1]) : undefined;
      if (!oid) {
        // Parent rule has no Policy of this type — unusual but possible
        // (e.g. a brand-new Policy added by an extension). Pass through
        // unchanged; the server will treat the missing action as "add".
        return full;
      }

      // Strip any pre-existing action / oid on the open tag so re-running
      // this transform stays idempotent. The Policy regex consumes the space
      // between the tag name and the first attr, so the first attr in `attrs`
      // has no leading whitespace — match `(?:^|\s+)` rather than `\s+`.
      const cleanedAttrs = attrs
        .replace(/(?:^|\s+)action="[^"]*"/g, '')
        .replace(/(?:^|\s+)oid="[^"]*"/g, '')
        .trim();
      const attrsBlock = cleanedAttrs.length > 0 ? ` ${cleanedAttrs}` : '';

      return `<${name} action="edit" oid="${oid}"${attrsBlock}>${inner}</${name}>`;
    },
  );

  return xml;
}
