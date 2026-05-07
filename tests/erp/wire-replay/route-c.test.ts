/**
 * Route C (overlay — frozen) wire-replay snapshots.
 * See README.md in this directory for convention. Route C is in
 * sunset mode; lever 3 will delete it. These snapshots lock the
 * current shape until then.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { ROUTE_C_CASES } from './cases-route-c';
import { normalizeGuids } from './normalize';

const SNAPSHOT_DIR = resolve(__dirname, '__snapshots__/route-c');

describe('wire-replay route C (overlay — frozen)', () => {
  for (const c of ROUTE_C_CASES) {
    it(`${c.name}`, async () => {
      const out = normalizeGuids(c.produce());
      await expect(out).toMatchFileSnapshot(`${SNAPSHOT_DIR}/${c.name}.xml`);
    });
  }
});
