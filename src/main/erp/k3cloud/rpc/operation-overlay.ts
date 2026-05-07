/**
 * Parent-FKERNELXML appearance-location extractors.
 *
 * **History**: this file used to host Route C (string-template) overlays for
 * FormOperation + Toolbar Button writes. Lever 3 followup (2026-05-07)
 * migrated all builders to Route B (envelope rebuild) — `connector.addToolbarButton`
 * / `removeToolbarButton` / `addCustomOperation` / `removeOperation` now use
 * `dcxml.ts` typed emitters via `SaveExtensionRequest` instead. The remaining
 * exports below are PARSERS only (read-only walks of parent FKERNELXML);
 * they're keep-alive because `connector.addToolbarButton` /
 * `removeToolbarButton` still need to discover the parent's appearance oid
 * to populate `BosBarButtonElement.appearanceOid` correctly.
 *
 * Per docs/architecture/bos-write-routes.md §3 Route C: **Route C is now
 * fully extinct**. New BOS write capabilities go through Route A (bridge) or
 * Route B (envelope rebuild).
 *
 * **TODO** (cosmetic): rename this file to `appearance-locator.ts` to match
 * its current purpose. Out of scope for the lever 3 follow-up.
 */

/**
 * Find a `<FormAppearance ... oid=...>` in parent FKERNELXML, returning
 * {oid, elementType} or null. ElementType=100 for FormAppearance per
 * capture req-96.
 */
export function extractFormAppearanceLocation(parentKernelXml: string): {
  oid: string;
  elementType: number;
} | null {
  const m = parentKernelXml.match(/<FormAppearance\b[^>]*\boid="([^"]+)"[^>]*\bElementType="(\d+)"/);
  if (!m) return null;
  return { oid: m[1], elementType: Number(m[2]) };
}

/**
 * Walk EntryEntityAppearance blocks in parent FKERNELXML; return the one
 * whose `<Key>X</Key>` matches `entityKey`. Used to anchor entry-level
 * toolbar additions (BosBarButtonElement.appearanceOid).
 */
export function extractEntryEntityAppearanceLocation(
  parentKernelXml: string,
  entityKey: string,
): { oid: string; elementType: number } | null {
  const re = /<EntryEntityAppearance\b[^>]*\boid="([^"]+)"[^>]*\bElementType="(\d+)"[\s\S]*?<\/EntryEntityAppearance>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(parentKernelXml)) !== null) {
    if (m[0].includes(`<Key>${entityKey}</Key>`)) {
      return { oid: m[1], elementType: Number(m[2]) };
    }
  }
  return null;
}
