/**
 * Dry-run: build a SaveExtensionRequest, render it via dcxml + buildParas
 * and diff against a captured BOS Designer payload — WITHOUT making the
 * actual RPC call. Used to validate our emitter byte-by-byte against
 * known-good wire samples before risking a server write.
 *
 * Compares against REQ #123 (TextField add to SAL_SaleOrder).
 *
 *   pnpm tsx scripts/bos-recon/smoke-save-dryrun.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildAp0Plain } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import type { SaveExtensionRequest } from '../../src/main/erp/k3cloud/rpc/types';

// Pull the captured ground-truth ap0.
const capturedAp0 = JSON.parse(
  fs.readFileSync(
    path.resolve('.scratch/captures/decoded/req-123/request-ap0.dec.txt'),
    'utf8',
  ),
);

// Reconstruct equivalent SaveExtensionRequest from what we observe in
// REQ #123. The key add was a TextField "F_PAIJ_Text_v9k".
const req: SaveExtensionRequest = {
  extension: {
    formId: '7d91d7fe-c8a6-4ed6-970c-7649c52b1ed8',
    baseObjectId: 'SAL_SaleOrder',
    modelTypeId: 100,
    subSystemId: '23',
    name: [{ localeId: 2052, value: '销售订单' }],
    isv: { devCode: 'PAIJ' },
  },
  isNew: false,
  layoutInfoOid: 'bc952920-057d-4790-9c27-1134091eb298',
  addFields: [
    {
      type: 'TextField',
      key: 'F_PAIJ_Text_v9k',
      caption: '文本',
      listTabIndex: 3135,
      id: '31da4c53e44c4203861080d612aea878',
    },
  ],
  addAppearances: [
    {
      type: 'TextField',
      key: 'F_PAIJ_Text_v9k',
      caption: '文本',
      container: 'FTAB_P0',
      zOrderIndex: 30,
      tabindex: 220,
      left: 10,
      top: 10,
      id: '29fd81b111e54eb4acb42a18285dc5f7',
    },
  ],
};

const ourAp0 = JSON.parse(buildAp0Plain(req));

console.log('=== Diff: our emitter vs captured REQ #123 ===');
console.log();
console.log('OUR __source__ (length=' + ourAp0.__source__.length + '):');
console.log(ourAp0.__source__);
console.log();
console.log('CAPTURED __source__ (length=' + capturedAp0.__source__.length + '):');
console.log(capturedAp0.__source__);
console.log();
console.log('--- __paras__ comparison ---');
const ourParas = JSON.parse(ourAp0.__paras__);
const capParas = JSON.parse(capturedAp0.__paras__);
const allKeys = new Set([...Object.keys(ourParas), ...Object.keys(capParas)]);
for (const k of [...allKeys].sort()) {
  const o = JSON.stringify(ourParas[k]);
  const c = JSON.stringify(capParas[k]);
  const mark = o === c ? '✓' : '✗';
  console.log(`  ${mark} ${k}: ours=${o} captured=${c}`);
}

const ourSource = ourAp0.__source__ as string;
const capSource = capturedAp0.__source__ as string;
console.log();
console.log('source byte-equal?', ourSource === capSource);
if (ourSource !== capSource) {
  // Find first divergence point.
  const minLen = Math.min(ourSource.length, capSource.length);
  let i = 0;
  while (i < minLen && ourSource[i] === capSource[i]) i++;
  console.log(`first divergence at char ${i}:`);
  console.log('  ours    : ...' + ourSource.slice(Math.max(0, i - 30), i + 60));
  console.log('  captured: ...' + capSource.slice(Math.max(0, i - 30), i + 60));
}
