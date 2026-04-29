/**
 * Rotate every BOS DCXML id (dashed Policy.Id, compact FieldMap.Id) so a
 * cloned extension XML has unique server-keyed lineage. No mapping table —
 * captured baselines have no cross-GUID references to preserve.
 */

import { newCompactGuid, newDashedGuid } from './dcxml';

const DASHED_GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
// Lookarounds prevent matching inside a longer hex run (e.g. a 64-char hash).
const COMPACT_GUID_RE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/g;

export function regenerateGuidsInXml(xml: string): string {
  const afterDashed = xml.replace(DASHED_GUID_RE, () => newDashedGuid());
  return afterDashed.replace(COMPACT_GUID_RE, () => newCompactGuid());
}
