import { callKdsvc, applySetCookieToSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';
import * as fs from 'node:fs';

const r = await login({
  baseUrl: 'http://localhost/k3cloud',
  acctId: '69a531ee82525a',
  username: 'demo',
  password: '1qaz@WSX',
});
const session = r.session;

const res = await callKdsvc(
  session,
  'Kingdee.BOS.ServiceFacade.ServicesStub.AppDesigner.AppDesignerService',
  'GetInstalledPackage',
  { apFields: {} },
);
applySetCookieToSession(session, res.setCookieHeaders);

fs.writeFileSync('.scratch/installed-packages.json', res.bodyText);
const arr = JSON.parse(res.bodyText) as Array<Record<string, unknown>>;
console.log('Total packages:', arr.length);

// Strip the noisy ColumnTypeFullName keys
function clean(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (k !== 'ColumnTypeFullName') out[k] = v;
  return out;
}

const unwPkgs = arr.filter((p) => {
  const isv = String(p.fisvid ?? '').toUpperCase();
  const dev = String(p.fdevcode ?? '').toUpperCase();
  return isv.includes('UNW') || dev.includes('UNW');
});
console.log('UNW packages:', unwPkgs.length);
for (const p of unwPkgs.slice(0, 5)) {
  console.log('  ', JSON.stringify(clean(p)));
}

// Search for IBHC-LMFG-style strings anywhere in raw body
const re = /[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}-[A-Z]{4}/g;
const matches = [...new Set(res.bodyText.match(re) ?? [])];
console.log('5-segment 4-char A-Z patterns:', matches.slice(0, 10));

// What columns/fields does each package have?
if (arr.length > 0) {
  console.log('\nPackage column names (sample[0]):');
  console.log('  ', Object.keys(arr[0]).filter((k) => k !== 'ColumnTypeFullName').join(', '));
}
