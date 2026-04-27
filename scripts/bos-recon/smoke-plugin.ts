/**
 * End-to-end smoke for registering a Python plugin on an existing extension.
 * Mirrors the wire format observed in capture req-75 (see memory
 * `bos_save_for_ide_v9_wire_format.md` + tests/erp/rpc/dcxml.test.ts).
 *
 * Usage:
 *   K3_USERNAME=demo K3_PASSWORD=1qaz@WSX K3_FID=<32-hex-extension-id> \
 *     pnpm tsx scripts/bos-recon/smoke-plugin.ts
 *
 * Prerequisite: extension already exists. Run smoke-save.ts first if you
 * need a fresh one. The plugin appears in BOS Designer's "表单插件" node
 * after refresh — verify visually before deleting.
 */

import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import type { SaveExtensionRequest } from '../../src/main/erp/k3cloud/rpc/types';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME;
const password = process.env.K3_PASSWORD;
const devCode = process.env.K3_DEVCODE ?? 'PAIJ';
const formId = process.env.K3_FID;
const layoutInfoOid =
  process.env.K3_LAYOUT_OID ?? 'bc952920-057d-4790-9c27-1134091eb298'; // SAL_SaleOrder default

if (!username || !password) {
  console.error('K3_USERNAME and K3_PASSWORD env vars required');
  process.exit(1);
}
if (!formId) {
  console.error('K3_FID env var required (32-hex extension FID)');
  process.exit(1);
}

const className =
  process.env.K3_PLUGIN_NAME ?? `smoke_${Math.random().toString(36).slice(2, 6)}`;
const pyScript =
  process.env.K3_PLUGIN_BODY ??
  `# OpenDeploy plugin smoke
from Kingdee.BOS.Core.DynamicForm.PlugIn import AbstractDynamicFormPlugIn

class ${className.replace(/[^a-zA-Z0-9]/g, '_')}(AbstractDynamicFormPlugIn):
    def AfterButtonClick(self, e):
        pass
`;

console.log('=== Login ===');
const loginResult = await login({ baseUrl, acctId, username, password });
if (!loginResult.isSuccess) {
  console.error('Login failed:', loginResult.message);
  process.exit(1);
}
console.log('logged in as', loginResult.userName);
console.log();

console.log('=== Register Python plugin ===');
console.log('extension FID :', formId);
console.log('class name    :', className);
console.log('script length :', pyScript.length, 'bytes');
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
  isNew: false,
  layoutInfoOid,
  addPlugins: [{ className, type: 'python', pyScript }],
};

const res = await saveExtension(loginResult.session, req);
console.log('=== Result ===');
console.log('isSuccess     :', res.isSuccess);
console.log('funcResult    :', res.funcResult);
console.log('messageTitle  :', res.messageTitle);
console.log('messageDetail :', res.messageDetail);
console.log();
if (res.isSuccess) {
  console.log('🎉 PLUGIN REGISTERED');
  console.log('  className :', className);
  console.log('  on extId  :', formId);
  console.log();
  console.log('Verify: open the extension in BOS Designer (refresh first), look under 表单插件.');
}
