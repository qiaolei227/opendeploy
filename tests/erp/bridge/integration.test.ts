/**
 * Integration smoke for the real bos-bridge executable. Skipped when the
 * binary isn't built (CI / dev machines without K/3 Cloud installed).
 *
 * Build locally with `dotnet build bos-bridge -c Release` to enable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { BridgeClient } from '../../../src/main/erp/k3cloud/bridge/client';
import { resolveBridgeExePath } from '../../../src/main/erp/k3cloud/bridge';

let bridgeExe: string | null = null;
try {
  bridgeExe = resolveBridgeExePath();
} catch {
  bridgeExe = null;
}

const describeIfBridge = bridgeExe ? describe : describe.skip;

describeIfBridge('bos-bridge integration', () => {
  let client: BridgeClient;
  const stderrLog: string[] = [];

  beforeAll(async () => {
    client = new BridgeClient({
      exePath: bridgeExe!,
      timeoutMs: 60_000,
      onLog: (line) => stderrLog.push(line),
    });
    await client.start();
  }, 90_000);

  afterAll(async () => {
    await client?.stop();
  });

  it('reports BOS schema build over stderr', () => {
    expect(stderrLog.some((l) => l.includes('schemas='))).toBe(true);
  });

  it('responds to ping', async () => {
    expect(await client.send('ping')).toBe('pong');
  });

  it('normalize_convert_rule preserves FieldMap + Policy counts', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml',
      'utf8',
    );
    const outputXml = await client.normalizeConvertRule(inputXml);

    expect(outputXml).toMatch(/^<\?xml/);
    expect(outputXml).toContain('<ConvertRuleMetaData>');
    expect(outputXml).toContain('<DefaultConvertPolicy>');
    expect(outputXml).toContain('<LinkEntityPolicy>');
    expect(outputXml).toContain('<BillTypeMapPolicy>');

    const countTag = (xml: string, tag: string) =>
      (xml.match(new RegExp(`<${tag}[ />]`, 'g')) || []).length;

    expect(countTag(outputXml, 'FieldMap')).toBe(countTag(inputXml, 'FieldMap'));
    expect(countTag(outputXml, 'DefaultConvertPolicy')).toBe(
      countTag(inputXml, 'DefaultConvertPolicy'),
    );
    expect(countTag(outputXml, 'LinkEntityPolicy')).toBe(countTag(inputXml, 'LinkEntityPolicy'));
    expect(countTag(outputXml, 'BillTypeMapPolicy')).toBe(
      countTag(inputXml, 'BillTypeMapPolicy'),
    );
  });

  it('returns BridgeError for unknown ops', async () => {
    await expect(client.send('this_op_does_not_exist')).rejects.toThrow(/unknown op/);
  });
});
