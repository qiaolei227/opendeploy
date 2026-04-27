/**
 * End-to-end smoke for deleteExtension. Removes a BOS extension by FID.
 *
 * Usage:
 *   K3_USERNAME=demo K3_PASSWORD=1qaz@WSX K3_FID=<32-hex> \
 *     pnpm tsx scripts/bos-recon/smoke-delete.ts
 *
 * Defaults to the smoke-save FID if K3_FID not set (look it up from your
 * smoke-save run output, or pass on the command line).
 */

import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { deleteExtension } from '../../src/main/erp/k3cloud/rpc/delete-extension';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME;
const password = process.env.K3_PASSWORD;
const devCode = process.env.K3_DEVCODE ?? 'PAIJ';
const formId = process.env.K3_FID;

if (!username || !password) {
  console.error('K3_USERNAME and K3_PASSWORD env vars required');
  process.exit(1);
}
if (!formId) {
  console.error('K3_FID env var required (32-hex extension FID)');
  process.exit(1);
}

console.log('=== Login ===');
const loginResult = await login({ baseUrl, acctId, username, password });
if (!loginResult.isSuccess) {
  console.error('Login failed:', loginResult.message);
  process.exit(1);
}
console.log('logged in as', loginResult.userName);
console.log();

console.log('=== Delete extension', formId, '===');
const res = await deleteExtension(loginResult.session, formId, { devCode });
console.log('ok           :', res.ok);
console.log('responseBody :', JSON.stringify(res.responseBody));
console.log('message      :', res.message ?? '(none)');
if (res.ok) {
  console.log();
  console.log('🧹 Extension removed.');
}
