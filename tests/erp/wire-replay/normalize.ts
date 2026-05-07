/**
 * Snapshot canonicalization helpers — mask volatile fields so wire-replay
 * tests survive across runs.
 *
 * Currently masks GUIDs (both dashed UUIDs and 32-hex undashed) by replacing
 * each unique GUID with `<GUID:N>` indexed by first occurrence. This preserves
 * cross-references (the same GUID appearing in two places gets the same index)
 * which is the load-bearing semantic — e.g. an Id and a corresponding oid
 * referencing it should still match after normalization.
 *
 * Inputs that DELIBERATELY use stable test GUIDs (`00000000...0001`,
 * `11111111-...`) round-trip correctly: they're seen first → assigned `<GUID:1>`
 * deterministically.
 *
 * Why not "replace all GUIDs with the same `<GUID>`"? That destroys cross-refs
 * — you couldn't tell whether a Form's Id field and a child element's parent oid
 * were intentionally identical or accidentally identical.
 */

const DASHED_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UNDASHED_UUID = /\b[0-9a-f]{32}\b/gi;

export function normalizeGuids(text: string): string {
  const seen = new Map<string, string>();

  // Pass 1: dashed first (longer pattern wins; if we did undashed first we'd
  // partially-match the "8-hex" leading segment of a dashed uuid and corrupt it).
  text = text.replace(DASHED_UUID, (m) => placeholder(seen, m));

  // Pass 2: undashed 32-hex.
  text = text.replace(UNDASHED_UUID, (m) => placeholder(seen, m));

  return text;
}

function placeholder(seen: Map<string, string>, match: string): string {
  // Treat the dashed and undashed forms of the same UUID as the SAME id.
  const key = match.replace(/-/g, '').toLowerCase();
  if (!seen.has(key)) {
    seen.set(key, `<GUID:${seen.size + 1}>`);
  }
  return seen.get(key)!;
}
