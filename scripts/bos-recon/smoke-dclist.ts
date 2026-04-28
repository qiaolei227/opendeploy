/**
 * Smoke: confirm getDataCenterList works against the real K/3 Cloud server.
 * No login required.
 */
import { getDataCenterList } from '../../src/main/erp/k3cloud/rpc/data-center';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';

console.log('=== GetDataCenterList ===');
console.log('baseUrl:', baseUrl);

const dcs = await getDataCenterList(baseUrl);

console.log();
console.log('count:', dcs.length);
for (const dc of dcs) {
  console.log(`  - id=${dc.id}  number=${dc.number}  name=${dc.name}`);
}
