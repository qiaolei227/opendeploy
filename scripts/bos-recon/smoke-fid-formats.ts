/**
 * Smoke: confirm getObject works with both dashed and compact GUID formats.
 *
 * Background: T_META_OBJECTTYPE.FID stores GUIDs in two flavors that BOS
 * Designer / OpenDeploy both produce. SQL `WHERE FID = @id` is literal-match,
 * so without the guidVariants() normalization, the wrong format silently
 * returned "not found" and the agent would lie to the user.
 *
 * This smoke uses the demo capture's known dashed extId
 * (df5bdd0d-fcbc-427c-87bd-a178f65a56e6) which a real BOS Designer save
 * created. Both formats below should hit the same row.
 *
 * Usage:
 *   pnpm tsx scripts/bos-recon/smoke-fid-formats.ts
 */

import sql from 'mssql';
import { getObject } from '../../src/main/erp/k3cloud/queries';

const config: sql.config = {
  server: 'localhost',
  port: 1433,
  database: 'AIS20260302144343',
  user: 'sa',
  password: '123',
  options: { encrypt: true, trustServerCertificate: true },
};

const DASHED = 'df5bdd0d-fcbc-427c-87bd-a178f65a56e6';
const COMPACT = 'df5bdd0dfcbc427c87bda178f65a56e6';

const pool = await sql.connect(config);
console.log('connected');

console.log();
console.log('=== getObject(dashed) ===');
const a = await getObject(pool, DASHED);
console.log('found:', a !== null);
console.log('id   :', a?.id);
console.log('name :', a?.name);

console.log();
console.log('=== getObject(compact — same row, different format) ===');
const b = await getObject(pool, COMPACT);
console.log('found:', b !== null);
console.log('id   :', b?.id);
console.log('name :', b?.name);

console.log();
console.log('=== getObject(SAL_SaleOrder — non-GUID FormID, sanity ===');
const c = await getObject(pool, 'SAL_SaleOrder');
console.log('found:', c !== null);
console.log('id   :', c?.id);

await pool.close();

if (a !== null && b !== null && a.id === b.id) {
  console.log();
  console.log('🎉 Both formats hit the same row. Bug fixed.');
} else {
  console.log();
  console.log('⚠️  Expected both formats to hit the same row.');
  process.exit(1);
}
