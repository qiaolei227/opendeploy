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

  // ── Plan 5.12.3b Task 2.2 — add_entity_service_rule ────────────────────
  // Adds an EntityServiceRule to BusinessInfo.HeadEntity.EntityServiceRules
  // and re-serializes. Round-trip via list_business_rules to confirm the
  // new rule is detected with the right ruleId, preCondition, and service
  // class (GetInvStockBusinessServiceMeta @ ActionId=67).

  it('add_entity_service_rule adds GetInvStock rule to HeadEntity, list returns it', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );
    const ruleId = '11111111-1111-1111-1111-111111111111';

    const { xml: patchedXml } = await client.send<{ xml: string }>('add_entity_service_rule', {
      xml: inputXml,
      ruleId,
      description: 'TS test - GetInvStock',
      preCondition: " FBillTypeID.FNumber = '01.01'",
      preConditionDesc: 'test',
      entityKey: 'FBillHead',
      services: [
        {
          className: 'GetInvStockBusinessServiceMeta',
          actionId: 67,
          properties: { StockQtyField: 'F_TestQty' },
        },
      ],
    });

    expect(patchedXml).toMatch(/^<\?xml/);

    const listed = await client.send<{
      entityRules: Array<{
        ruleId: string;
        entityKey: string;
        preCondition: string;
        services: Array<{ branch: string; actionId: number; className: string }>;
      }>;
    }>('list_business_rules', { xml: patchedXml });

    const found = listed.entityRules.find((r) => r.ruleId === ruleId);
    expect(found).toBeDefined();
    expect(found!.entityKey).toBe('FBillHead');
    expect(found!.preCondition).toContain("'01.01'");
    expect(found!.services).toHaveLength(1);
    expect(found!.services[0]).toMatchObject({
      branch: 'whenTrue',
      actionId: 67,
      className: 'GetInvStockBusinessServiceMeta',
    });
  });

  it('add_entity_service_rule rejects empty preCondition', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );
    await expect(
      client.send('add_entity_service_rule', {
        xml: inputXml,
        ruleId: '22222222-2222-2222-2222-222222222222',
        description: 'no precondition',
        preCondition: '',
        services: [
          {
            className: 'GetInvStockBusinessServiceMeta',
            actionId: 67,
            properties: {},
          },
        ],
      }),
    ).rejects.toThrow(/preCondition/i);
  });

  // base FormBusinessService is what Calculate (ActionId=2) uses at the
  // entity level. Smoke covers the path of instantiating the base class
  // (no subclass) via ServiceMetaTypes index — separate from the
  // GetInvStockBusinessServiceMeta subclass path covered above.
  it('add_entity_service_rule supports base FormBusinessService (Calculate)', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );
    const ruleId = '33333333-3333-3333-3333-333333333333';

    const { xml: patchedXml } = await client.send<{ xml: string }>('add_entity_service_rule', {
      xml: inputXml,
      ruleId,
      description: 'TS test - Calculate at entity level',
      preCondition: 'True',
      services: [
        {
          className: 'FormBusinessService',
          actionId: 2,
          properties: { Parameters: '[" F_TestDecimal = 1 "]' },
        },
      ],
    });

    const listed = await client.send<{ entityRules: any[] }>('list_business_rules', {
      xml: patchedXml,
    });
    const found = listed.entityRules.find((r: any) => r.ruleId === ruleId);
    expect(found).toBeDefined();
    expect(found.services).toHaveLength(1);
    expect(found.services[0]).toMatchObject({
      actionId: 2,
      className: 'FormBusinessService',
    });
  });

  // ── Plan 5.12.3b Task 2.3 — add_field_update_action ────────────────────
  // Adds a FormBusinessService instance to a Field's UpdateActions
  // collection (the field-level Calculate use case: fire when this field
  // changes). Round-trip via list_business_rules to confirm the new action
  // is detected with the right fieldKey + actionId + parameters substring.

  it('add_field_update_action adds Calculate UpdateAction to a Field, list returns it', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );

    const { xml: patchedXml } = await client.send<{ xml: string }>('add_field_update_action', {
      xml: inputXml,
      // Fixture's only IntegerField — plan pseudocode said F_TestInt but
      // the seeded fixture uses the project's actual prefix.
      fieldKey: 'F_PAIJ_TestInt',
      services: [
        {
          className: 'FormBusinessService',
          actionId: 2,
          parameters: [' F_TestDecimal = F_PAIJ_TestInt * 2 '],
        },
      ],
      disabledEvents: ['RaiseValueChanged'],
    });

    expect(patchedXml).toMatch(/^<\?xml/);
    // disabledEvents went through to wire — assert directly since the list
    // summary doesn't surface RaiseEvent settings.
    expect(patchedXml).toContain('<RaiseValueChanged>DisableRaise</RaiseValueChanged>');

    const listed = await client.send<{
      fieldUpdateActions: Array<{
        fieldKey: string;
        actionId: number;
        className: string;
        parameters?: string;
      }>;
    }>('list_business_rules', { xml: patchedXml });

    const action = listed.fieldUpdateActions.find((a) => a.fieldKey === 'F_PAIJ_TestInt');
    expect(action).toBeDefined();
    expect(action!.actionId).toBe(2);
    expect(action!.className).toBe('FormBusinessService');
    // Parameters property serializes back as the JSON-string we set.
    expect(action!.parameters).toContain('F_TestDecimal');
    expect(action!.parameters).toContain('F_PAIJ_TestInt');
  });

  it('add_field_update_action rejects unknown fieldKey', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );
    await expect(
      client.send('add_field_update_action', {
        xml: inputXml,
        fieldKey: 'F_DoesNotExist',
        services: [
          {
            className: 'FormBusinessService',
            actionId: 2,
            parameters: [' F_X = 1 '],
          },
        ],
      }),
    ).rejects.toThrow(/F_DoesNotExist/);
  });

  // ── Plan 5.12.3b Task 2.4 — remove_business_rule ───────────────────────
  // Scans entity-level EntityServiceRules first, then field-level
  // UpdateActions. First Id match wins and is removed; result.location
  // tells the caller which collection it came from. Throws with /not
  // found/ when the ruleId matches nothing — agents need a clear error to
  // surface to the user (silent no-op would be a bug).

  it('remove_business_rule removes entity service rule by id, list confirms gone', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );
    const ruleId = '22222222-2222-2222-2222-222222222222';

    const { xml: withRule } = await client.send<{ xml: string }>('add_entity_service_rule', {
      xml: inputXml,
      ruleId,
      description: 'temp',
      preCondition: 'True',
      services: [
        { className: 'GetInvStockBusinessServiceMeta', actionId: 67, properties: {} },
      ],
    });

    const { xml: removed, location } = await client.send<{ xml: string; location: string }>(
      'remove_business_rule',
      { xml: withRule, ruleId },
    );
    expect(location).toBe('entity');

    const listed = await client.send<{ entityRules: Array<{ ruleId: string }> }>(
      'list_business_rules',
      { xml: removed },
    );
    expect(listed.entityRules.find((r) => r.ruleId === ruleId)).toBeUndefined();
  });

  it('remove_business_rule removes field update action by id, location reports "field"', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );

    const { xml: withAction } = await client.send<{ xml: string }>('add_field_update_action', {
      xml: inputXml,
      // Same prefix correction as Task 2.3 — fixture uses F_PAIJ_TestInt
      // (project namespace), not the F_TestInt that plan pseudocode shows.
      fieldKey: 'F_PAIJ_TestInt',
      services: [
        {
          className: 'FormBusinessService',
          actionId: 2,
          parameters: ['F_TestDecimal = 1'],
        },
      ],
    });
    const listed1 = await client.send<{ fieldUpdateActions: Array<{ serviceId: string }> }>(
      'list_business_rules',
      { xml: withAction },
    );
    const serviceId = listed1.fieldUpdateActions[0].serviceId;
    expect(serviceId).toBeTruthy();

    const { location } = await client.send<{ xml: string; location: string }>(
      'remove_business_rule',
      { xml: withAction, ruleId: serviceId },
    );
    expect(location).toBe('field');
  });

  it('remove_business_rule throws clearly when ruleId not found', async () => {
    const inputXml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/business-rules-no-rules.xml',
      'utf8',
    );
    await expect(
      client.send('remove_business_rule', { xml: inputXml, ruleId: 'does-not-exist' }),
    ).rejects.toThrow(/not found/);
  });

  // ── Plan 5.12.6 Task 2.1 — list_operations ───────────────────────────
  // Read-only walk over a FormMetadata DCXML — enumerates Form.FormOperations
  // (custom operations like TESTCopy / OperationId=2 复制 variant or
  // OperationId=45 自定义) and LayoutInfo's BarDataManager.BarItems
  // (toolbar BarButtonItem nodes, optionally bound to an operation via
  // ClickActions/FormBusinessService.Parameters=["<opKey>"]). Wire shape
  // verified by capture req-96 (docs/recon/2026-05-06-operations-spike.md).

  it('list_operations returns empty arrays for extension with no FormOperations and no BarItems', async () => {
    const xml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/operations-no-ops.xml',
      'utf8',
    );
    const result = await client.send<{ operations: unknown[]; toolbarButtons: unknown[] }>(
      'list_operations',
      { xml },
    );
    expect(result.operations).toEqual([]);
    expect(result.toolbarButtons).toEqual([]);
  });

  it('list_operations finds FormOperation + BarButtonItem in fixture', async () => {
    const xml = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/operations-with-ops.xml',
      'utf8',
    );
    const result = await client.send<{
      operations: Array<{
        operationKey: string;
        operationId: number;
        operationName: string;
      }>;
      toolbarButtons: Array<{
        buttonKey: string;
        caption: string;
        boundOperationKey: string | null;
      }>;
    }>('list_operations', { xml });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      operationKey: 'TESTCopy',
      operationId: 2,
      operationName: 'TEST复制',
    });

    expect(result.toolbarButtons).toHaveLength(1);
    expect(result.toolbarButtons[0]).toMatchObject({
      buttonKey: 'UNW_tbButton',
      caption: '按钮',
      boundOperationKey: 'TESTCopy',
    });
  });

  it('list_operations rejects empty xml', async () => {
    await expect(client.send('list_operations', { xml: '' })).rejects.toThrow(/xml is empty/);
  });

  // ── Plan 5.12.6 Task 2.2 — add_custom_operation ───────────────────────
  // Append a FormOperation to Form.FormOperations. Default OperationId=45
  // (DoNothing / 自定义) per recon §3.3 — agents can override for variants
  // like OperationId=2 (复制 with custom Parmeter). When pluginClassName is
  // non-empty, also build a ServicePlugins/PlugIn entry with PlugInType=1
  // (Python) and inline pyBody as ScriptString. Round-trip via list_operations
  // to confirm the new op surfaces with the right operationKey + operationId
  // + operationName + hasInlineScript flag.

  it('add_custom_operation adds an OperationId=45 custom op without plugin', async () => {
    const baseline = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/operations-no-ops.xml',
      'utf8',
    );
    const patched = await client.send<{ xml: string }>('add_custom_operation', {
      xml: baseline,
      operationKey: 'NewOp',
      operationName: '新自定义操作',
      operationParameterId: '11111111-1111-1111-1111-111111111111',
    });

    expect(patched.xml).toMatch(/^<\?xml/);

    const list = await client.send<{
      operations: Array<{
        operationKey: string;
        operationId: number;
        operationName: string;
        hasInlineScript?: boolean;
      }>;
    }>('list_operations', { xml: patched.xml });
    expect(list.operations).toHaveLength(1);
    expect(list.operations[0]).toMatchObject({
      operationKey: 'NewOp',
      operationId: 45,
      operationName: '新自定义操作',
    });
    // hasInlineScript not exposed by list_operations summary; verify wire
    // shape directly: no <ServicePlugins> when no plugin was added.
    expect(patched.xml).not.toContain('<ServicePlugins>');
  });

  it('add_custom_operation adds op with inline Python via ServicePlugins', async () => {
    const baseline = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/operations-no-ops.xml',
      'utf8',
    );
    const pyBody = `# test plugin
class MyHandler:
    def AfterDoOperation(self, e): pass`;
    const patched = await client.send<{ xml: string }>('add_custom_operation', {
      xml: baseline,
      operationKey: 'PyOp',
      operationName: 'Py操作',
      operationParameterId: '22222222-2222-2222-2222-222222222222',
      pluginClassName: 'my_handler',
      pyBody,
    });
    expect(patched.xml).toContain('<ServicePlugins>');
    expect(patched.xml).toContain('<ClassName>my_handler</ClassName>');
    expect(patched.xml).toContain('<PlugInType>1</PlugInType>');
    expect(patched.xml).toContain('class MyHandler:');
  });

  it('add_custom_operation rejects empty operationKey', async () => {
    const baseline = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/operations-no-ops.xml',
      'utf8',
    );
    await expect(
      client.send('add_custom_operation', {
        xml: baseline,
        operationKey: '',
        operationName: 'x',
        operationParameterId: '33333333-3333-3333-3333-333333333333',
      }),
    ).rejects.toThrow(/operationKey/);
  });

  it('add_custom_operation rejects duplicate operationKey', async () => {
    const fixture = readFileSync(
      'src/main/erp/k3cloud/rpc/baselines/operations-with-ops.xml',
      'utf8',
    );
    await expect(
      client.send('add_custom_operation', {
        xml: fixture,
        operationKey: 'TESTCopy', // already exists in the with-ops fixture
        operationName: 'x',
        operationParameterId: '44444444-4444-4444-4444-444444444444',
      }),
    ).rejects.toThrow(/已存在/);
  });
});
