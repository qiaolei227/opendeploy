/**
 * Smoke: load enum items for one enum type.
 *
 * Decompile:
 *   DynamicObject LoadEnumObjectV9(string pk) — single enum by GUID
 *   List<Dictionary<string,string>> GetEnumData(fid, enumType, enumTypeL,
 *                                                enumItem, enumItemL)
 *   Dictionary<string,string> GetBusinessObjectMetaData(formId, ...)
 *
 * Goal: figure out which read returns the enum's items (Value + DisplayText).
 */
import {
  callKdsvc,
  encodeApField,
  encodeApFieldRaw,
  applySetCookieToSession,
  parseJsonResponse,
} from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'demo';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';

const sampleEnumId = process.env.K3_ENUM_ID ?? '0014a9de-81a6-4cb1-9534-6fdb2fb21e2a'; // APS排程维度

console.log('=== Login ===');
const loginRes = await login({ baseUrl, acctId, username, password });
if (!loginRes.isSuccess) process.exit(1);
const session = loginRes.session;

const META_SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.MetadataService';
const SQL_SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.SQLScriptService';

interface Probe {
  name: string;
  service: string;
  method: string;
  apFields: Record<string, string>;
}

const probes: Probe[] = [
  { name: 'LoadEnumObjectV9(pk)', service: META_SVC, method: 'LoadEnumObjectV9', apFields: { ap0: encodeApFieldRaw(sampleEnumId) } },
  { name: 'LoadEnumObject(pk)', service: META_SVC, method: 'LoadEnumObject', apFields: { ap0: encodeApFieldRaw(sampleEnumId) } },
  { name: 'GetBusinessObjectMetaData(enumId)', service: SQL_SVC, method: 'GetBusinessObjectMetaData', apFields: { ap0: encodeApFieldRaw(sampleEnumId), ap1: encodeApField([2052]) } },
  // GetEnumData: 5 args — try with sample fid + table names
  { name: 'GetEnumData(fid, FormEnum tables...)', service: META_SVC, method: 'GetEnumData', apFields: { ap0: encodeApFieldRaw(sampleEnumId), ap1: encodeApFieldRaw('T_META_FORMENUM'), ap2: encodeApFieldRaw('T_META_FORMENUM_L'), ap3: encodeApFieldRaw('T_META_FORMENUMITEM'), ap4: encodeApFieldRaw('T_META_FORMENUMITEM_L') } },
];

async function manualRaw(svc: string, method: string, apFields: Record<string, string>): Promise<{ status: number; len: number; head: string; isText: boolean }> {
  const url = `${baseUrl}/${svc}.${method}.common.kdsvc`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(apFields)) form.append(k, v);
  form.append('nonce', '');
  form.append('v', '1.0');
  form.append('compressed', 'True');
  form.append('CompressedApx', 'True');
  form.append('compressedapxtype', 'v2');
  form.append('format', '1');
  form.append('timestamp', new Date().toISOString().replace('T', ' ').slice(0, 19));
  form.append('sign', '');
  form.append('useragent', 'Kingdee.BOS.IDE');
  const cookies: string[] = [];
  if (session.kdServiceSessionId) cookies.push(`kdservice-sessionid=${session.kdServiceSessionId}`);
  if (session.aspNetSessionId) cookies.push(`ASP.NET_SessionId=${session.aspNetSessionId}`);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookies.join('; '),
      'kdservice-sessionid': session.kdServiceSessionId ?? '',
    },
    body: form.toString(),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  // Heuristic: text response starts with `[` `{` or `response_error:`
  const head = buf.subarray(0, 600).toString('utf-8');
  const isText = /^\s*[\[{"]/.test(head) || head.startsWith('response_error:');
  return { status: r.status, len: buf.length, head: head.replace(/\n/g, ' '), isText };
}

for (const p of probes) {
  console.log();
  console.log('===', p.name, '===');
  try {
    const r = await callKdsvc(session, p.service, p.method, { apFields: p.apFields });
    applySetCookieToSession(session, r.setCookieHeaders);
    console.log('  body len:', r.bodyText.length, '(decoded ok)');
    console.log('  head:', r.bodyText.slice(0, 600).replace(/\n/g, ' '));
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outDir = path.join('.scratch', 'enum-items');
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = p.name.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);
    fs.writeFileSync(path.join(outDir, `${fileName}.json`), r.bodyText);
    console.log(`  → wrote .scratch/enum-items/${fileName}.json`);
  } catch (err) {
    console.log('  decoder threw:', String(err).slice(0, 200));
    console.log('  retrying raw...');
    const m = await manualRaw(p.service, p.method, p.apFields);
    console.log('  raw status:', m.status, 'bytes:', m.len, 'isText:', m.isText);
    console.log('  raw head:', m.head.slice(0, 500));
  }
}
