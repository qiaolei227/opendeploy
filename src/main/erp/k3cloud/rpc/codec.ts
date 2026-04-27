/**
 * BOS RPC application-layer codec.
 *
 * BOS Designer's HTTP RPC wraps every payload in two compression layers:
 *   1. Application layer:  base64(zlib_deflate_with_header(utf8(json)))
 *      Triggered by request fields compressed=True / CompressedApx=True.
 *   2. HTTP layer:          gzip / Content-Encoding: gzip
 *      Standard HTTP, handled by Node's http client transparently.
 *
 * This module is the application-layer (1). HTTP-layer is the http client's
 * concern. zlib header observed: 0x78 0x9C (default deflate, no preset dict).
 *
 * Round-trip:   payload → encodeAppLayer → form field value → server
 *               server response → decodeAppLayer → payload
 *
 * Empirical evidence: see .scratch/captures/decoded/req-98 — ap0 field
 * round-trips through this codec without loss.
 */

import * as zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

export function encodeAppLayer(payload: string | Buffer): string {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  return zlib.deflateSync(buf).toString('base64');
}

export function decodeAppLayer(encoded: string): Buffer {
  const compressed = Buffer.from(encoded.trim(), 'base64');
  return zlib.inflateSync(compressed);
}

export function decodeAppLayerString(encoded: string): string {
  return decodeAppLayer(encoded).toString('utf8');
}
