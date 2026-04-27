/**
 * Decode a captured BOS RPC request/response from capture-proxy.ts logs.
 *
 * Usage:
 *   pnpm tsx scripts/bos-recon/decode-capture.ts <log-file> <reqId>
 *
 * Writes decoded artifacts to .scratch/captures/decoded/req-<id>/:
 *   - meta.json           (URL, headers, form keys, summary)
 *   - request-body.txt    (the URL-decoded form, one field per line)
 *   - request-<key>.bin   (raw bytes after URL-decode)
 *   - request-<key>.dec.txt   (URL-decoded → base64 → zlib inflate, if it
 *                              looks compressed; UTF-8 if valid; else hex)
 *   - response-body.bin   (raw response bytes as our proxy logged them,
 *                          already gunzipped at the HTTP layer)
 *   - response-body.dec.txt   (further base64+zlib decode if applicable)
 *
 * Compression scheme observed (BOS Designer ↔ K3 Cloud):
 *   - HTTP layer: gzip (decoded by capture-proxy already)
 *   - App layer:  base64(zlib-deflate(payload))
 *     Triggered by request fields compressed=True / CompressedApx=True.
 *     The payload is `{__source__: DCXML, __paras__: JSON, <lcid>: DCXML, ...}`.
 *     Response body uses the same base64+zlib wrapper.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { URLSearchParams } from 'node:url';

const [, , logFile, reqIdArg] = process.argv;
if (!logFile || !reqIdArg) {
  console.error('Usage: decode-capture.ts <log-file> <reqId>');
  process.exit(1);
}
const reqId = Number(reqIdArg);
if (!Number.isFinite(reqId)) {
  console.error('reqId must be a number');
  process.exit(1);
}

const log = fs.readFileSync(logFile, 'utf8');
const lines = log.split('\n');

function findBlock(id: number): { start: number; end: number } {
  const start = lines.findIndex((l) => l.startsWith(`# REQ ${id} `));
  if (start < 0) throw new Error(`REQ ${id} not found in log`);
  let end = lines.findIndex(
    (l, idx) => idx > start && l.startsWith('# REQ ') && !l.startsWith(`# REQ ${id} `),
  );
  if (end < 0) end = lines.length;
  return { start, end };
}

function extractSection(blockLines: string[], header: string): string[] {
  const i = blockLines.findIndex((l) => l === header);
  if (i < 0) return [];
  let j = i + 1;
  while (
    j < blockLines.length &&
    !blockLines[j].startsWith('--- ') &&
    !blockLines[j].startsWith('====')
  ) j++;
  // also drop trailing empty lines so respBodyText is just the payload
  let k = j;
  while (k > i + 1 && blockLines[k - 1] === '') k--;
  return blockLines.slice(i + 1, k);
}

function tryAppDecompress(buf: Buffer): { decoded: Buffer; note: string } {
  const s = buf.toString('utf8').trim();
  // base64 then zlib(deflate w/ header) — observed scheme
  if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length > 8) {
    try {
      const compressed = Buffer.from(s, 'base64');
      const out = zlib.inflateSync(compressed);
      return { decoded: out, note: `base64 → zlib (in:${compressed.length} → out:${out.length})` };
    } catch {
      /* fall through */
    }
  }
  return { decoded: buf, note: 'identity (no app-layer compression detected)' };
}

function isPrintable(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  let printable = 0;
  const sample = Math.min(buf.length, 4096);
  for (let i = 0; i < sample; i++) {
    const b = buf[i];
    if ((b >= 0x20 && b < 0x7f) || b === 9 || b === 10 || b === 13) printable++;
  }
  return printable / sample > 0.85;
}

const { start, end } = findBlock(reqId);
const block = lines.slice(start, end);

const reqLine = block[1] ?? '';
const headerJsonLines = extractSection(block, '--- request headers');
const reqHeaders = headerJsonLines.length ? JSON.parse(headerJsonLines.join('\n')) : {};
const reqBodySection = extractSection(block, '--- request body');
const reqBodyHeaderLine = reqBodySection[0] ?? '';
const reqBodyText = reqBodySection.slice(1).join('\n');

const respHeaderJsonLines = extractSection(block, '--- response headers');
const respHeaders = respHeaderJsonLines.length ? JSON.parse(respHeaderJsonLines.join('\n')) : {};
const respLine = block.find((l) => l.startsWith('--- response  ')) ?? '';
const respBodySection = extractSection(block, '--- response body');
const respBodyText = respBodySection.slice(1).join('\n');

const outDir = path.join(path.dirname(logFile), 'decoded', `req-${reqId}`);
fs.mkdirSync(outDir, { recursive: true });

// Parse form
const params = new URLSearchParams(reqBodyText);
const formKeys = [...params.keys()];

const meta: Record<string, unknown> = {
  reqLine,
  reqHeaders,
  reqBodyHeader: reqBodyHeaderLine,
  formKeys,
  formScalar: Object.fromEntries(
    formKeys
      .filter((k) => {
        const v = params.get(k) ?? '';
        return v.length < 200 && !/^[A-Za-z0-9+/=]+$/.test(v);
      })
      .map((k) => [k, params.get(k)]),
  ),
  respLine,
  respHeaders,
  respBodyHeader: respBodySection[0] ?? '',
};

fs.writeFileSync(path.join(outDir, 'request-body.txt'), reqBodyText);

// dump each form field, trying app-layer decompress
for (const k of formKeys) {
  const v = params.get(k) ?? '';
  if (!v) continue;
  const safeKey = k.replace(/[^A-Za-z0-9_-]/g, '_') || '_empty';
  const raw = Buffer.from(v, 'utf8');
  fs.writeFileSync(path.join(outDir, `request-${safeKey}.bin`), raw);
  const { decoded, note } = tryAppDecompress(raw);
  if (note.startsWith('base64')) {
    if (isPrintable(decoded)) {
      fs.writeFileSync(path.join(outDir, `request-${safeKey}.dec.txt`), decoded.toString('utf8'));
    } else {
      fs.writeFileSync(path.join(outDir, `request-${safeKey}.dec.bin`), decoded);
    }
    (meta.appLayerDecoded ??= {} as Record<string, string>);
    (meta.appLayerDecoded as Record<string, string>)[k] = note;
  }
}

// response
fs.writeFileSync(path.join(outDir, 'response-body.bin'), Buffer.from(respBodyText, 'utf8'));
const respDecoded = tryAppDecompress(Buffer.from(respBodyText, 'utf8'));
if (respDecoded.note.startsWith('base64')) {
  const target = isPrintable(respDecoded.decoded) ? 'response-body.dec.txt' : 'response-body.dec.bin';
  fs.writeFileSync(path.join(outDir, target), respDecoded.decoded);
  meta.responseAppLayer = respDecoded.note;
}

fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

console.log(`decoded REQ ${reqId} → ${outDir}`);
console.log('  reqLine:', reqLine);
console.log('  form keys:', formKeys.join(', '));
if ((meta as { appLayerDecoded?: Record<string, string> }).appLayerDecoded) {
  console.log('  app-layer decoded:', (meta as { appLayerDecoded: Record<string, string> }).appLayerDecoded);
}
console.log('  response app-layer:', meta.responseAppLayer ?? 'identity');
console.log('  files:');
for (const f of fs.readdirSync(outDir)) console.log('    ' + f);
