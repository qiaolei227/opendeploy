/**
 * Build the **local patch-base XML** stored in `convert-rule-ext/<extId>.json`
 * for a freshly-created convert-rule extension.
 *
 * This XML is **not** what we send to the server. The server gets the
 * 275-byte `buildMinimalExtensionXml` body from `extend-convert-rule.ts`,
 * which carries only `<Status action="reset"/>` + `<Id>` + `<Key>` so the
 * server inherits all Policies/FieldMaps from the parent rule via
 * `paras.BaseObjectId`. Sending more would standalone-ize the rule.
 *
 * What this XML IS for: subsequent `addConvertFieldMapping` /
 * `setConvertGroupBy` / `setConvertFilter` etc. calls go through the .NET
 * bridge, which deserializes the local state.xml into a `ConvertRuleMetaData`
 * via `DcxmlSerializer`, mutates a property (e.g. `policy.FieldMaps.Add`),
 * then re-serializes. The bridge requires the Policy collection to already
 * contain a `DefaultConvertPolicyElement` at the right TargetEntryKey to
 * have a mount point — see `BosContext.FindDefaultConvertPolicy`.
 *
 * The minimal extension XML (what we send) has no `<Policies>` at all, so
 * if it were also used as the patch base, every patch op would client-side
 * throw `no DefaultConvertPolicy with TargetEntryKey=…` before reaching
 * the server. That's exactly what 0df79625's commit body flagged as the
 * outstanding follow-up: "those ops still operate on the full state.xml
 * from the old extensionTemplate shape, which no longer matches what the
 * server stores."
 *
 * We pull the structural shell from the bundled `extensionTemplateXml`
 * (captured from BOS Designer's create-extension flow), regenerate
 * internal GUIDs so multiple extensions don't collide on Policy/FieldMap
 * Ids, then **clear all FieldMaps**. The cloned shell carries the right
 * Policy schemas (header-level DefaultConvertPolicy, ConvertGroupByPolicy,
 * ConvertFilterPolicy, etc.) so the bridge can find mount points; cleared
 * FieldMaps are critical because:
 *
 *   - `patchExtXml` re-serializes the post-patch local XML and sends it as
 *     `__rules__[1].source`. If we left the parent's 275 cloned FieldMaps
 *     in place, the server would record our extension as overriding all
 *     of them — turning every parent FieldMap into a redundant declaration
 *     under our extension. Empty FieldMaps means "extension overrides
 *     nothing yet"; each subsequent patch adds exactly one entry, which is
 *     what BOS Designer does when a user manually adds a single mapping.
 */

import { regenerateGuidsInXml } from './regenerate-guids';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface BuildPatchBaseXmlArgs {
  /** Bundled extension template XML — `baseline.extensionTemplateXml`. */
  templateXml: string;
  /** GUID for the new extension; written into the rule's `<Id>` and `<Key>`. */
  newExtensionId: string;
  /** Display name shown in BOS Designer's tree. */
  displayName: string;
}

/**
 * Produce the local patch-base XML for a new convert-rule extension.
 *
 * Steps:
 *   1. Rotate every internal GUID in the template (Policy.Id, FieldMap.Id,
 *      etc.) so distinct extensions don't share Ids — `regenerateGuidsInXml`
 *      handles both dashed and compact forms.
 *   2. Empty out every `<FieldMaps>…</FieldMaps>` block to a self-closing
 *      `<FieldMaps />`. Only DefaultConvertPolicy carries this collection
 *      in the SaleOrder-OutStock template, but the regex is intentionally
 *      generic so adding new templates doesn't require revisiting this fn.
 *   3. Replace the rule-level `<Name>` / `<Id>` / `<Key>` (sitting just
 *      after `</Policies>`) with the caller's values. The `<Name>` is what
 *      BOS Designer shows in the tree; `<Id>` and `<Key>` must match the
 *      `newExtensionId` we registered with the server in `SaveRulesV9`.
 */
export function buildPatchBaseXml(args: BuildPatchBaseXmlArgs): string {
  const { templateXml, newExtensionId, displayName } = args;

  let xml = regenerateGuidsInXml(templateXml);

  xml = xml.replace(/<FieldMaps>[\s\S]*?<\/FieldMaps>/g, '<FieldMaps />');

  // Match the rule-level Name/Id/Key triple — the `<Name>` is optional in
  // the template (some captures omit it when no display name was set).
  // Anchor on `</Policies>` to avoid matching nested Policy element ids.
  const ruleNameIdKey = /<\/Policies>(<Name>[\s\S]*?<\/Name>)?<Id>[^<]*<\/Id><Key>[^<]*<\/Key>/;
  if (!ruleNameIdKey.test(xml)) {
    throw new Error(
      'buildPatchBaseXml: cannot locate rule-level Name/Id/Key after </Policies> — template shape unexpected',
    );
  }
  xml = xml.replace(
    ruleNameIdKey,
    `</Policies><Name>${escapeXml(displayName)}</Name><Id>${newExtensionId}</Id><Key>${newExtensionId}</Key>`,
  );

  return xml;
}
