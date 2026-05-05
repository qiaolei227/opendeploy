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
    // Policy elements MUST carry ElementType="..." for the K/3 server's
    // type-resolution; without them SaveRulesV9 fails with "未能找到XX对应的数据类型".
    expect(outputXml).toMatch(/<DefaultConvertPolicy ElementType=/);
    expect(outputXml).toMatch(/<LinkEntityPolicy ElementType=/);
    expect(outputXml).toMatch(/<BillTypeMapPolicy ElementType=/);

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

  it('add_convert_field_map appends a FieldMap to the named entry', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml',
      'utf8',
    );
    const countTag = (xml: string, tag: string) =>
      (xml.match(new RegExp(`<${tag}[ />]`, 'g')) || []).length;
    const before = countTag(inputXml, 'FieldMap');

    const result = await client.send<{ xml: string }>('add_convert_field_map', {
      xml: inputXml,
      target_field_key: 'FBridgeProbe',
      source_field_key: 'FQty',
      mode: 'Auto',
      target_entry_key: 'FEntity',
    });

    expect(countTag(result.xml, 'FieldMap')).toBe(before + 1);
    expect(result.xml).toContain('<TargetFieldKey>FBridgeProbe</TargetFieldKey>');
    expect(result.xml).toContain('<SourceFieldKey>FQty</SourceFieldKey>');
  });

  it('add_convert_field_map rejects unknown ValueConvertMode', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml',
      'utf8',
    );
    await expect(
      client.send('add_convert_field_map', {
        xml: inputXml,
        target_field_key: 'FBridgeProbe',
        source_field_key: 'FQty',
        mode: 'NotARealMode',
        target_entry_key: 'FEntity',
      }),
    ).rejects.toThrow(/invalid mode/);
  });

  it('add_convert_field_map rejects when target entry not found', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml',
      'utf8',
    );
    await expect(
      client.send('add_convert_field_map', {
        xml: inputXml,
        target_field_key: 'FBridgeProbe',
        source_field_key: 'FQty',
        mode: 'Auto',
        target_entry_key: 'FDoesNotExist',
      }),
    ).rejects.toThrow(/no DefaultConvertPolicy/);
  });

  it('set_convert_group_by replaces the rule-level group-by policy', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml',
      'utf8',
    );
    const result = await client.send<{ xml: string }>('set_convert_group_by', {
      xml: inputXml,
      mode: 'GroupByField',
      field1: 'FCustId',
      field2: 'FBillTypeId',
    });
    expect(result.xml).toContain('<GroupByMode>GroupByField</GroupByMode>');
    expect(result.xml).toContain('<GroupByField>FCustId</GroupByField>');
    expect(result.xml).toContain('<GroupByField2>FBillTypeId</GroupByField2>');
  });

  it('set_convert_group_by rejects unknown mode', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml',
      'utf8',
    );
    await expect(
      client.send('set_convert_group_by', { xml: inputXml, mode: 'NotARealMode' }),
    ).rejects.toThrow(/invalid GroupByMode/);
  });

  // ── Plan 5.12.3b Task 2.1 — list_business_rules ───────────────────────
  // Walks BusinessInfo on a deserialized FormMetadata and emits a typed
  // summary. Read-only — no XML rewrite. Subsequent add/remove ops
  // (Tasks 2.2–2.4) reuse this deserialize path.

  it('list_business_rules returns empty arrays for form with no rules', async () => {
    const xml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );
    const result = await client.send<{
      entityRules: unknown[];
      fieldUpdateActions: unknown[];
    }>('list_business_rules', { xml });
    expect(result.entityRules).toEqual([]);
    expect(result.fieldUpdateActions).toEqual([]);
  });

  it('list_business_rules finds GetInvStock entity rule + Calculate UpdateAction', async () => {
    const xml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-with-rules.xml',
      'utf8',
    );
    const result = await client.send<{
      entityRules: Array<{
        ruleId: string;
        entityKey: string;
        preCondition: string;
        preConditionDesc?: string;
        description?: string;
        seq?: number;
        services: Array<{ branch: string; actionId: number; className: string; serviceId: string }>;
      }>;
      fieldUpdateActions: Array<{
        fieldKey: string;
        actionId: number;
        className: string;
        serviceId: string;
        parameters?: string;
      }>;
    }>('list_business_rules', { xml });

    expect(result.entityRules).toHaveLength(1);
    const rule = result.entityRules[0];
    expect(rule.ruleId).toBe('0c027f9c-00c0-4a8f-b0c0-171ad7682d7e');
    expect(rule.preCondition).toContain("'01.01'");
    expect(rule.services).toHaveLength(1);
    expect(rule.services[0]).toMatchObject({
      branch: 'whenTrue',
      actionId: 67,
      className: 'GetInvStockBusinessServiceMeta',
    });

    expect(result.fieldUpdateActions).toHaveLength(1);
    expect(result.fieldUpdateActions[0]).toMatchObject({
      fieldKey: 'F_PAIJ_TestInt',
      actionId: 2,
      className: 'FormBusinessService',
    });
  });

  it('list_business_rules rejects empty xml', async () => {
    await expect(client.send('list_business_rules', { xml: '' })).rejects.toThrow(/xml is empty/);
  });
});
