/**
 * BOS Designer ↔ K3 Cloud Server HTTP RPC capture proxy.
 *
 * Sits between Kingdee.BOS.IDE.exe and the local K3 Cloud web server.
 * Records every request + response to .scratch/captures/<timestamp>.log
 * for offline analysis of the SaveForIDEV9 / Login / etc payloads.
 *
 * Usage:
 *   1. Make sure K3 Cloud server is running on http://localhost  (default port 80).
 *   2. Run:   pnpm tsx scripts/bos-recon/capture-proxy.ts
 *      (defaults: listen on :8888, forward to http://localhost:80)
 *   3. In BOS Designer login dialog, change the server URL to:
 *        http://localhost:8888/k3cloud
 *      Log in normally and perform the operation you want to capture.
 *   4. Each request lands in .scratch/captures/<ts>.log as a self-contained
 *      block; the index file .scratch/captures/index.txt summarises requests.
 *   5. Ctrl-C to stop. Re-running rotates to a new log file.
 *
 * Env overrides:
 *   CAPTURE_LISTEN_PORT  default 8888
 *   CAPTURE_TARGET_HOST  default localhost
 *   CAPTURE_TARGET_PORT  default 80
 *   CAPTURE_OUT_DIR      default .scratch/captures
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

const LISTEN_PORT = Number(process.env.CAPTURE_LISTEN_PORT ?? 8888);
const TARGET_HOST = process.env.CAPTURE_TARGET_HOST ?? 'localhost';
const TARGET_PORT = Number(process.env.CAPTURE_TARGET_PORT ?? 80);
const OUT_DIR = process.env.CAPTURE_OUT_DIR ?? path.join(process.cwd(), '.scratch', 'captures');

fs.mkdirSync(OUT_DIR, { recursive: true });
const sessionTs = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(OUT_DIR, `${sessionTs}.log`);
const indexPath = path.join(OUT_DIR, 'index.txt');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

let reqCounter = 0;

function tryDecompress(buf: Buffer, encoding: string | undefined): { body: Buffer; note: string } {
  if (!encoding) return { body: buf, note: 'identity' };
  try {
    if (/gzip/i.test(encoding)) return { body: zlib.gunzipSync(buf), note: 'gunzip' };
    if (/deflate/i.test(encoding)) return { body: zlib.inflateSync(buf), note: 'inflate' };
    if (/br/i.test(encoding)) return { body: zlib.brotliDecompressSync(buf), note: 'brotli' };
  } catch (e) {
    return { body: buf, note: `decompress failed: ${(e as Error).message}` };
  }
  return { body: buf, note: encoding };
}

function isPrintable(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  let printable = 0;
  const sampleSize = Math.min(buf.length, 4096);
  for (let i = 0; i < sampleSize; i++) {
    const b = buf[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / sampleSize > 0.85;
}

function previewBody(buf: Buffer, encoding: string | undefined): string {
  const { body, note } = tryDecompress(buf, encoding);
  if (isPrintable(body)) {
    return `[decoded ${note}, ${body.length} bytes]\n${body.toString('utf8')}`;
  }
  return `[binary ${note}, ${body.length} bytes — hex prefix]\n${body.subarray(0, 256).toString('hex')}\n[...]`;
}

const server = http.createServer((clientReq, clientRes) => {
  const reqId = ++reqCounter;
  const startedAt = Date.now();
  const reqChunks: Buffer[] = [];
  clientReq.on('data', (c) => reqChunks.push(c));
  clientReq.on('end', () => {
    const reqBody = Buffer.concat(reqChunks);
    const upstreamHeaders = { ...clientReq.headers };
    upstreamHeaders.host = `${TARGET_HOST}${TARGET_PORT === 80 ? '' : ':' + TARGET_PORT}`;
    delete upstreamHeaders['content-length'];
    if (reqBody.length > 0) upstreamHeaders['content-length'] = String(reqBody.length);

    const upstreamReq = http.request(
      {
        host: TARGET_HOST,
        port: TARGET_PORT,
        method: clientReq.method,
        path: clientReq.url,
        headers: upstreamHeaders,
      },
      (upstreamRes) => {
        const respChunks: Buffer[] = [];
        upstreamRes.on('data', (c) => respChunks.push(c));
        upstreamRes.on('end', () => {
          const respBody = Buffer.concat(respChunks);

          // Stream the (still-encoded) response back to the client untouched.
          clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          clientRes.end(respBody);

          const ms = Date.now() - startedAt;
          const block = [
            '================================================================',
            `# REQ ${reqId}  ${new Date(startedAt).toISOString()}  +${ms}ms`,
            `${clientReq.method} ${clientReq.url}  HTTP/${clientReq.httpVersion}`,
            '--- request headers',
            JSON.stringify(clientReq.headers, null, 2),
            '--- request body',
            previewBody(reqBody, clientReq.headers['content-encoding'] as string | undefined),
            `--- response  ${upstreamRes.statusCode} ${upstreamRes.statusMessage ?? ''}`,
            '--- response headers',
            JSON.stringify(upstreamRes.headers, null, 2),
            '--- response body',
            previewBody(respBody, upstreamRes.headers['content-encoding'] as string | undefined),
            '',
            '',
          ].join('\n');
          logStream.write(block);

          const url = clientReq.url ?? '';
          const summary = url.includes('.kdsvc')
            ? url.replace(/^.*\/([^/]+\.kdsvc).*$/, '$1')
            : url.length > 80
              ? url.slice(0, 77) + '...'
              : url;
          const indexLine = `[${new Date(startedAt).toISOString()}] #${String(reqId).padStart(4, '0')}  ${clientReq.method} ${upstreamRes.statusCode}  ${summary}\n`;
          fs.appendFileSync(indexPath, indexLine);
          process.stdout.write(indexLine);
        });
      },
    );
    upstreamReq.on('error', (e) => {
      const msg = `upstream error: ${e.message}`;
      console.error(msg);
      logStream.write(`# REQ ${reqId} FAILED ${msg}\n${clientReq.method} ${clientReq.url}\n\n`);
      if (!clientRes.headersSent) clientRes.writeHead(502, { 'content-type': 'text/plain' });
      clientRes.end(msg);
    });
    if (reqBody.length > 0) upstreamReq.write(reqBody);
    upstreamReq.end();
  });
  clientReq.on('error', (e) => {
    console.error('client error:', e.message);
  });
});

server.listen(LISTEN_PORT, () => {
  const banner = [
    '',
    '──────────────────────────────────────────────────────────────',
    ` BOS RPC capture proxy`,
    `   listen   : http://localhost:${LISTEN_PORT}`,
    `   forward  : http://${TARGET_HOST}:${TARGET_PORT}`,
    `   log file : ${logPath}`,
    `   index    : ${indexPath}`,
    '',
    ' In BOS Designer login dialog, set server URL to:',
    `   http://localhost:${LISTEN_PORT}/k3cloud`,
    '',
    ' Then perform the operation you want to capture.',
    ' Ctrl-C to stop.',
    '──────────────────────────────────────────────────────────────',
    '',
  ].join('\n');
  process.stdout.write(banner);
  logStream.write(`# capture session started ${new Date().toISOString()}\n# listen ${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT}\n\n`);
});

process.on('SIGINT', () => {
  process.stdout.write('\n[capture proxy] shutting down\n');
  logStream.end();
  server.close(() => process.exit(0));
});
