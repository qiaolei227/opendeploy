/**
 * Parent-FKERNELXML appearance-location extractors.
 *
 * Read-only regex walks of parent FKERNELXML to discover appearance oids
 * (FormAppearance / EntryEntityAppearance). Used by Route B writers
 * (`connector.addToolbarButton` / `removeToolbarButton`) to populate
 * `BosBarButtonElement.appearanceOid` — toolbar buttons must anchor to the
 * parent's existing appearance element, which lives in the parent's wire
 * envelope, not in our extension's diff.
 *
 * **Not an emitter** — does not construct any wire XML. Per
 * docs/architecture/bos-write-routes.md §3 Route C: **Route C is extinct**;
 * all BOS writes go through Route A (bridge) or Route B (envelope rebuild).
 *
 * **History**: previously named `operation-overlay.ts` (it hosted Route C
 * string-template overlays). Lever 3 followup (2026-05-07) migrated all
 * write paths to Route B; rename followup (2026-05-08) shed the stale name.
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
