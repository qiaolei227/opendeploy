/**
 * Smoke: GetBusinessObjectMetaData — the candidate replacement for SQL T_META_*
 * reads. Decompile shows it returns Dictionary<string, string> where each
 * value is a complete metadata XML string. If true, our existing
 * parseFkernelXmlFields / parseFormPluginsFromKernelXml work unchanged.
 */
import { callKdsvc, encodeApFieldRaw, encodeApField, applySetCookieToSession } from '../../src/main/erp/k3cloud/rpc/http-client';
import { login } from '../../src/main/erp/k3cloud/rpc/login';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'demo';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';
const objectId = process.env.K3_OBJ_ID ?? 'SAL_SaleOrder';

console.log('=== Login ===');
const loginRes = await login({ baseUrl, acctId, username, password });
console.log('login ok:', loginRes.isSuccess, 'userId:', loginRes.userId);
if (!loginRes.isSuccess) {
  console.error('login failed:', loginRes.message);
  process.exit(1);
}
const session = loginRes.session;

const SVC = 'Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.SQLScriptService';

async function manualFetch(fields: Record<string, string>): Promise<{ status: number; head: string; bytes: number }> {
  const url = `${baseUrl}/${SVC}.GetBusinessObjectMetaData.common.kdsvc`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
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
  return { status: r.status, bytes: buf.length, head: buf.subarray(0, 300).toString('utf-8').replace(/\n|\t/g, ' ') };
}

console.log();
console.log('=== GetBusinessObjectMetaData ===');
console.log('objectId:', objectId);
const variants: Array<{ name: string; fields: Record<string, string> }> = [
  { name: 'ap1=[2052] (JSON array)', fields: { ap0: encodeApFieldRaw(objectId), ap1: encodeApField([2052]) } },
  { name: 'no ap1', fields: { ap0: encodeApFieldRaw(objectId) } },
  { name: 'ap1=raw "2052"', fields: { ap0: encodeApFieldRaw(objectId), ap1: encodeApFieldRaw('2052') } },
  { name: 'ap1=raw "[2052]"', fields: { ap0: encodeApFieldRaw(objectId), ap1: encodeApFieldRaw('[2052]') } },
  { name: 'ap1=encoded "2052" string', fields: { ap0: encodeApFieldRaw(objectId), ap1: encodeApField('2052') } },
];
let okBody: string | null = null;
for (const v of variants) {
  console.log('--- variant:', v.name, '---');
  try {
    const r = await callKdsvc(session, SVC, 'GetBusinessObjectMetaData', { apFields: v.fields });
    applySetCookieToSession(session, r.setCookieHeaders);
    console.log('  ok body len:', r.bodyText.length);
    console.log('  head:', r.bodyText.slice(0, 200).replace(/\n/g, ' '));
    okBody = r.bodyText;
    break;
  } catch (err) {
    const m = await manualFetch(v.fields);
    console.log('  decoder threw, raw → status', m.status, 'bytes', m.bytes);
    console.log('  raw head:', m.head);
  }
}

if (okBody) {
  console.log();
  console.log('=== Parsing JSON body ===');
  const parsed = JSON.parse(okBody) as Record<string, string>;
  const keys = Object.keys(parsed);
  console.log('keys:', keys);

  // Drop the full XML to disk for inspection
  const fs = await import('node:fs');
  const path = await import('node:path');
  const outDir = path.join('.scratch', 'getbomd', objectId);
  fs.mkdirSync(outDir, { recursive: true });
  for (const k of keys) {
    const filePath = path.join(outDir, `${k}.xml`);
    fs.writeFileSync(filePath, parsed[k]);
    console.log(`  wrote ${filePath}  (${parsed[k].length} chars)`);
  }

  // Hunt for KernelXml-like content + field hints in main metaData
  const main = parsed['metaData'] ?? '';
  const kernelXmlIdx = main.indexOf('<FKERNELXML>');
  const fieldHits = (main.match(/<TextField|<BaseDataField|<DateField|<ComboField|<BasePropertyField|<FormPlugins/g) ?? []).length;
  console.log();
  console.log('--- Reconnaissance ---');
  console.log('FKERNELXML section starts at offset:', kernelXmlIdx);
  console.log('field-tag occurrences in metaData:', fieldHits);
  if (kernelXmlIdx >= 0) {
    console.log();
    console.log('FKERNELXML head (1000 chars):');
    console.log(main.substring(kernelXmlIdx, kernelXmlIdx + 1000).replace(/\n/g, ' '));
  }

  // Also look for the extension marker — does this format expose <FormPlugins>?
  const formPluginsIdx = main.indexOf('<FormPlugins');
  console.log();
  console.log('FormPlugins offset:', formPluginsIdx);
  if (formPluginsIdx >= 0) {
    console.log('FormPlugins head:');
    console.log(main.substring(formPluginsIdx, formPluginsIdx + 500).replace(/\n/g, ' '));
  }
}
