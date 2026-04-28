/** Decode the GetDataCenterList response from the original capture. */
import { decodeAppLayerString } from '../../src/main/erp/k3cloud/rpc/codec';

// Captured 2026-04-27 from REQ 2 of session log 2026-04-27T05-58-02-806Z.log
const responseBody =
  'eJx9UU1Lw0AQ/Suy5xzyQalVnfBKR2VWKEgsglu0Y3Wmm2WyT0HpvT8CMW//Q==';

// Actually grab from capture log directly
import * as fs from 'node:fs';
const log = fs.readFileSync('.scratch/captures/2026-04-27T05-58-02-806Z.log', 'utf8');
const reqStart = log.indexOf('# REQ 2');
const reqEnd = log.indexOf('# REQ 3', reqStart);
const reqBlock = log.substring(reqStart, reqEnd);

// Find response body line (after "[decoded gunzip,")
const m = reqBlock.match(/\[decoded gunzip, \d+ bytes\]\n([A-Za-z0-9+/=]+)/);
if (!m) {
  console.error('could not find response body in REQ 2');
  process.exit(1);
}
const real = m[1].trim();
console.log('encoded length:', real.length);
const decoded = decodeAppLayerString(real);
console.log('\n=== DECODED RESPONSE ===');
console.log(decoded);
console.log('\n=== Parsed JSON ===');
const parsed = JSON.parse(decoded);
console.log(JSON.stringify(parsed, null, 2));
