/**
 * Route B (envelope rebuild) wire-replay snapshots.
 * See README.md in this directory for convention + how to add cases.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { buildAp0Plain } from '../../../src/main/erp/k3cloud/rpc/save-for-ide';
import { ROUTE_B_CASES } from './cases-route-b';
import { normalizeGuids } from './normalize';

const SNAPSHOT_DIR = resolve(__dirname, '__snapshots__/route-b');

describe('wire-replay route B (envelope rebuild)', () => {
  for (const c of ROUTE_B_CASES) {
    it(`${c.name}`, async () => {
      const ap0Raw = buildAp0Plain(c.input);
      const ap0 = JSON.parse(ap0Raw) as Record<string, string>;

      // Normalize auto-generated GUIDs to stable indexed placeholders so the
      // snapshot survives across runs (otherwise every uuidv4() call breaks it).
      // Repeated GUIDs preserve their cross-reference: same id → same <GUID:N>.
      const sourceNorm = normalizeGuids(ap0.__source__);
      const parasPretty = JSON.stringify(JSON.parse(ap0.__paras__), null, 2);
      const parasNorm = normalizeGuids(parasPretty);

      await expect(sourceNorm).toMatchFileSnapshot(`${SNAPSHOT_DIR}/${c.name}/source.xml`);
      await expect(parasNorm).toMatchFileSnapshot(`${SNAPSHOT_DIR}/${c.name}/paras.json`);
    });
  }
});
