import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { encodeAppLayer, decodeAppLayer, decodeAppLayerString } from '../../../src/main/erp/k3cloud/rpc/codec';

describe('rpc/codec', () => {
  it('round-trips a JSON payload', () => {
    const payload = JSON.stringify({ hello: '世界', nested: { n: 1, b: true } });
    const encoded = encodeAppLayer(payload);
    expect(decodeAppLayerString(encoded)).toBe(payload);
  });

  it('decodes a real captured ap0 from BOS Designer (REQ #98 SaveForIDEV9)', () => {
    // Live sample captured 2026-04-27 — see memory bos_save_for_ide_v9_wire_format.md.
    // This is the ap0 value (base64+zlib) for the original BaseDataField save.
    const fixture = path.resolve('.scratch/captures/decoded/req-98/request-ap0.bin');
    if (!fs.existsSync(fixture)) {
      // Skip when capture artifacts haven't been produced (CI / fresh clone).
      return;
    }
    const ap0 = fs.readFileSync(fixture, 'utf8');
    const decoded = decodeAppLayerString(ap0);
    const json = JSON.parse(decoded);
    expect(json).toHaveProperty('__source__');
    expect(json).toHaveProperty('__paras__');
    expect(json.__source__).toContain('<FormMetadata>');
    expect(json.__source__).toContain('<BaseDataField');
  });

  it('handles trailing whitespace in encoded input (response body in capture logs)', () => {
    const payload = 'hello';
    const encoded = encodeAppLayer(payload);
    expect(decodeAppLayerString(encoded + '\n  ')).toBe(payload);
  });

  it('returns a Buffer for binary payload round-trip', () => {
    const bin = Buffer.from([0x00, 0x01, 0xff, 0x7f, 0x80]);
    const encoded = encodeAppLayer(bin);
    const decoded = decodeAppLayer(encoded);
    expect(Buffer.compare(decoded, bin)).toBe(0);
  });
});
