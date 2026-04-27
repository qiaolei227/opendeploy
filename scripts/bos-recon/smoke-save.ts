/**
 * End-to-end smoke for saveExtension — creates a NEW minimal extension on
 * SAL_SaleOrder with a single TextField. Mutates server state.
 *
 * Usage:
 *   K3_USERNAME=demo K3_PASSWORD=1qaz@WSX pnpm tsx scripts/bos-recon/smoke-save.ts
 *
 * Cleanup: the new extension's FID is logged at the end. Either delete
 * via BOS Designer (open the extension, right-click → delete) or leave
 * it — it's harmless on the parent SAL_SaleOrder.
 */

import { randomUUID } from 'node:crypto';
import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import type { SaveExtensionRequest } from '../../src/main/erp/k3cloud/rpc/types';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME;
const password = process.env.K3_PASSWORD;
const devCode = process.env.K3_DEVCODE ?? 'PAIJ';

if (!username || !password) {
  console.error('K3_USERNAME and K3_PASSWORD env vars required');
  process.exit(1);
}

console.log('=== Login ===');
const loginResult = await login({ baseUrl, acctId, username, password });
if (!loginResult.isSuccess) {
  console.error('Login failed:', loginResult.message);
  process.exit(1);
}
console.log('logged in as', loginResult.userName, '(UserId=' + loginResult.userId + ')');
console.log();

const formId = randomUUID().replace(/-/g, '');
const fieldKey = `F_${devCode}_OdT_${Math.random().toString(36).slice(2, 5)}`;
const layoutInfoOid = 'bc952920-057d-4790-9c27-1134091eb298'; // from capture, SAL_SaleOrder's main layout

console.log('=== saveExtension (isNew, SAL_SaleOrder, 1× TextField) ===');
console.log('extension FID :', formId);
console.log('field key     :', fieldKey);
console.log('devCode       :', devCode);
console.log();

const req: SaveExtensionRequest = {
  extension: {
    formId,
    baseObjectId: 'SAL_SaleOrder',
    modelTypeId: 100,
    subSystemId: '23',
    name: [{ localeId: 2052, value: 'OpenDeploy 烟测扩展' }],
    isv: { devCode },
  },
  isNew: true,
  layoutInfoOid,
  addFields: [
    {
      type: 'TextField',
      key: fieldKey,
      caption: 'OpenDeploy 测试字段',
      listTabIndex: 9000,
    },
  ],
  addAppearances: [
    {
      type: 'TextField',
      key: fieldKey,
      caption: 'OpenDeploy 测试字段',
      container: 'FTAB_P0',
      zOrderIndex: 999,
      tabindex: 9000,
      left: 10,
      top: 10,
    },
  ],
};

try {
  const res = await saveExtension(loginResult.session, req);
  console.log('=== Result ===');
  console.log('isSuccess     :', res.isSuccess);
  console.log('funcResult    :', res.funcResult);
  console.log('messageTitle  :', res.messageTitle);
  console.log('messageDetail :', res.messageDetail);
  console.log();
  if (res.isSuccess) {
    console.log('🎉 EXTENSION CREATED');
    console.log('  FID    :', formId);
    console.log('  Name   : OpenDeploy 烟测扩展');
    console.log('  Parent : SAL_SaleOrder');
    console.log('  Field  : ' + fieldKey + ' (TextField "OpenDeploy 测试字段")');
    console.log();
    console.log('Cleanup: open it in BOS Designer (refresh extension list first), right-click → delete.');
  } else {
    console.log('saveExtension rejected — diagnose from messageTitle/messageDetail above.');
  }
} catch (e) {
  console.error('=== Threw ===');
  console.error(e);
  process.exit(1);
}
