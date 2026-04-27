/**
 * End-to-end smoke test for the BOS RPC Login flow.
 *
 * Drives `src/main/erp/k3cloud/rpc/login.ts` against a real K/3 Cloud
 * Web Server and reports what the server says.
 *
 * Usage:
 *   pnpm tsx scripts/bos-recon/smoke-login.ts
 *
 * Env overrides:
 *   K3_BASE_URL    default http://localhost/k3cloud
 *   K3_ACCT_ID     default 69a531ee82525a (LoginSetting.xml DataCenterID)
 *   K3_USERNAME    required
 *   K3_PASSWORD    required
 */

import { login, fetchPublicKeyInfo } from '../../src/main/erp/k3cloud/rpc/login';
import { cipherPasswordForLogin, deobfuscatePassword } from '../../src/main/erp/k3cloud/rpc/password';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME;
const password = process.env.K3_PASSWORD;

if (!username || !password) {
  console.error('K3_USERNAME and K3_PASSWORD env vars required');
  process.exit(1);
}

console.log('=== Login smoke test ===');
console.log('baseUrl :', baseUrl);
console.log('acctId  :', acctId);
console.log('username:', username);
console.log('password: <hidden, length=' + password.length + '>');
console.log();

// Step 1: pull GetPublicKeyInfo to learn which crypto path the server expects.
console.log('--- Step 1: GetPublicKeyInfo ---');
const obfuscatedKey = await fetchPublicKeyInfo({ baseUrl }, acctId);
console.log('returned (length):', obfuscatedKey.length);
console.log('returned (first 60 chars):', JSON.stringify(obfuscatedKey.slice(0, 60)));
if (obfuscatedKey) {
  const cleartextKey = deobfuscatePassword(obfuscatedKey);
  console.log('deobfuscated (length):', cleartextKey.length);
  console.log('deobfuscated (first 60 chars):', JSON.stringify(cleartextKey.slice(0, 60)));
  console.log('cooked password (length):', cipherPasswordForLogin(password, obfuscatedKey).length);
} else {
  console.log('empty → will fall back to obfuscation (NOT real RSA encryption)');
  console.log('cooked password preview:', cipherPasswordForLogin(password, obfuscatedKey));
}
console.log();

// Step 2: full login.
console.log('--- Step 2: ValidateLoginInfo ---');
try {
  const result = await login({ baseUrl, acctId, username, password });
  console.log('isSuccess  :', result.isSuccess);
  console.log('userId     :', result.userId);
  console.log('userName   :', result.userName);
  console.log('customName :', result.customName);
  console.log('message    :', result.message);
  console.log('messageCode:', result.messageCode);
  console.log('session    :');
  console.log('  baseUrl              :', result.session.baseUrl);
  console.log('  aspNetSessionId      :', result.session.aspNetSessionId);
  console.log('  kdServiceSessionId   :', result.session.kdServiceSessionId);
  console.log('  accessToken (prefix) :', result.session.accessToken?.slice(0, 16) + '...');
} catch (e) {
  console.error('=== Threw ===');
  console.error(e);
  process.exit(1);
}
