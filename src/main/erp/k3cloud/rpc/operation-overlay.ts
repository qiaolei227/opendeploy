/**
 * String-template overlays for FormOperation + Toolbar Button writes
 * (Plan 5.12.6 Path A — bridge baseline-diff mode in Plan 5.12.6 hit
 * silent-drop because BOS DcxmlSerializer's `action="edit"` emission
 * requires byte-exact primary-key match against parent.Form, see
 * docs/recon/2026-05-06-operations-spike.md spike #1).
 *
 * Path A bypasses the BOS client serializer entirely: we ship a hand-written
 * baseline-diff overlay XML fragment that the BOS *server's* deserializer
 * applies. The wire shape is taken verbatim from `dcxml.ts:86` (the
 * register_python_plugins template, which has been in production since
 * Plan 5 with no silent-drop reports).
 *
 * The overlay is spliced into the existing extension FKERNELXML via the
 * shared `injectOverlay` helper in `business-rule-overlay.ts` (5.12.3b).
 */

import { injectOverlay } from './business-rule-overlay';

export { injectOverlay };

/* ---------- Common ---------- */

const C_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escCData(value: string): string {
  // CDATA can't contain `]]>`; escape by splitting + concatenating.
  return value.replace(/]]>/g, ']]]]><![CDATA[>');
}

function assertCIdent(name: string, label: string): void {
  if (!C_IDENT_RE.test(name)) {
    throw new Error(`${label}: must be a C-identifier (got "${name}")`);
  }
}

/* ---------- add_custom_operation ---------- */

export interface AddCustomOperationArgs {
  /** ext.id — used as Form.Id (compact 32-hex GUID, no dashes). */
  extensionFormId: string;
  /** unique within form — equals both `<Id>` and `<Operation>` of FormOperation. */
  operationKey: string;
  operationName: string;
  /** dashed UUID for `<OperationParameter><Id>`. */
  operationParameterId: string;
  /** default 45 (DoNothing / 自定义). */
  operationId?: number;
  /** OperationParameter.OperationObjectKey — usually empty for header-level ops. */
  operationObjectKey?: string;
  /** OperationParameter.ExpressValue — semicolon-separated `key:value` pairs. */
  expressValue?: string;
  /** When set, emits `<ServicePlugins><PlugIn>` block (Python plugin). */
  pluginClassName?: string;
  /** IronPython source body — inlined as `<PyScript><![CDATA[...]]></PyScript>`. */
  pyBody?: string;
  /** LoadKeys JSON string, default `[]`. */
  loadKeys?: string;
}

/**
 * Build a `<Form action="edit" oid="BOS_BillModel">` overlay carrying one
 * new `<FormOperation>` (and optionally a `<ServicePlugins>` entry).
 * Caller splices via `injectOverlay(extXml, overlay)` then ships.
 */
export function buildAddCustomOperationOverlay(args: AddCustomOperationArgs): string {
  if (!args.extensionFormId) throw new Error('buildAddCustomOperationOverlay: extensionFormId required');
  assertCIdent(args.operationKey, 'buildAddCustomOperationOverlay: operationKey');
  if (!args.operationName) throw new Error('buildAddCustomOperationOverlay: operationName required');
  if (!args.operationParameterId) throw new Error('buildAddCustomOperationOverlay: operationParameterId required');
  // Form.Id wire = compact 32-hex per BOS Designer convention; strip dashes.
  const formId = args.extensionFormId.replace(/-/g, '');
  const opId = args.operationId ?? 45;

  // OperationParameter children — only emit non-empty siblings.
  const objectKey = args.operationObjectKey
    ? `<OperationObjectKey>${xmlEscape(args.operationObjectKey)}</OperationObjectKey>`
    : '';
  const expressValue = args.expressValue
    ? `<ExpressValue>${xmlEscape(args.expressValue)}</ExpressValue>`
    : '';

  // ServicePlugins — present only when caller supplies a plugin.
  let servicePluginsXml = '';
  if (args.pluginClassName) {
    const pyScript = args.pyBody
      ? `<PyScript><![CDATA[${escCData(args.pyBody)}]]></PyScript>`
      : '';
    servicePluginsXml =
      `<ServicePlugins>` +
        `<PlugIn ElementType="0" ElementStyle="0">` +
          `<ClassName>${xmlEscape(args.pluginClassName)}</ClassName>` +
          `<PlugInType>1</PlugInType>` +
          pyScript +
        `</PlugIn>` +
      `</ServicePlugins>`;
  }

  return (
    `<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">` +
      `<Id>${xmlEscape(formId)}</Id>` +
      `<FormOperations>` +
        `<FormOperation>` +
          `<Id>${xmlEscape(args.operationKey)}</Id>` +
          `<Operation>${xmlEscape(args.operationKey)}</Operation>` +
          `<BeforeOpAlterInfo />` +
          `<AfterOpAlterInfo />` +
          `<AfterOpFailedInfo action="setnull" />` +
          `<OperationId>${opId}</OperationId>` +
          `<OperationName>${xmlEscape(args.operationName)}</OperationName>` +
          `<Parmeter>` + // typo preserved per recon §3.2
            `<OperationParameter>` +
              `<Id>${xmlEscape(args.operationParameterId)}</Id>` +
              objectKey +
              expressValue +
            `</OperationParameter>` +
          `</Parmeter>` +
          `<LoadKeys>${xmlEscape(args.loadKeys ?? '[]')}</LoadKeys>` +
          servicePluginsXml +
        `</FormOperation>` +
      `</FormOperations>` +
    `</Form>`
  );
}

/* ---------- remove_operation ---------- */

/**
 * Build a `<Form action="edit">` overlay that removes one FormOperation
 * by key. BOS server's deserializer accepts `action="remove" oid=`
 * declarative removal on collection elements (5.12.3b business-rule
 * remove path uses identical pattern).
 */
export function buildRemoveOperationOverlay(extensionFormId: string, operationKey: string): string {
  if (!extensionFormId) throw new Error('buildRemoveOperationOverlay: extensionFormId required');
  assertCIdent(operationKey, 'buildRemoveOperationOverlay: operationKey');
  const formId = extensionFormId.replace(/-/g, '');
  return (
    `<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">` +
      `<Id>${xmlEscape(formId)}</Id>` +
      `<FormOperations>` +
        `<FormOperation action="remove" oid="${xmlEscape(operationKey)}" />` +
      `</FormOperations>` +
    `</Form>`
  );
}

/* ---------- add_toolbar_button ---------- */

export interface AddToolbarButtonArgs {
  extensionFormId: string;
  /** form-level FormAppearance oid (parent appearance container), or
   *  entry-level EntryEntityAppearance oid (resolved by entityKey). */
  appearanceOid: string;
  /** "FormAppearance" | "EntryEntityAppearance" — wire tag. */
  appearanceKind: 'FormAppearance' | 'EntryEntityAppearance';
  /** ElementType="100" for form-level, "35" for entry-level. */
  appearanceElementType: number;
  buttonKey: string;
  buttonId: string;
  caption: string;
  seq?: number;
  boundOperationKey: string;
  boundOperationName: string;
  toolbarKey: string;
  barDataManagerId: string;
  formBusinessServiceId: string;
  barItemLinkId: string;
}

export function buildAddToolbarButtonOverlay(args: AddToolbarButtonArgs): string {
  assertCIdent(args.buttonKey, 'buildAddToolbarButtonOverlay: buttonKey');
  assertCIdent(args.boundOperationKey, 'buildAddToolbarButtonOverlay: boundOperationKey');
  assertCIdent(args.toolbarKey, 'buildAddToolbarButtonOverlay: toolbarKey');
  if (!args.appearanceOid) throw new Error('appearanceOid required');
  const seq = args.seq ?? 1;
  // Build ClickActions JSON-array Parameters string.
  const paramsJson = JSON.stringify([args.boundOperationKey]);

  return (
    `<${args.appearanceKind} action="edit" oid="${xmlEscape(args.appearanceOid)}" ElementType="${args.appearanceElementType}" ElementStyle="1">` +
      `<Menu>` +
        `<BarDataManager>` +
          `<Id>${xmlEscape(args.barDataManagerId)}</Id>` +
          `<BarItems>` +
            `<BarButtonItem ElementType="2005" ElementStyle="1">` +
              `<Shortcut />` +
              `<Seq>${seq}</Seq>` +
              `<Description>按钮</Description>` +
              `<IsShowTitle>True</IsShowTitle>` +
              `<ClickActions>` +
                `<FormBusinessService>` +
                  `<ConfirmInfo />` +
                  `<Parameters>${xmlEscape(paramsJson)}</Parameters>` +
                  `<ActionId>23</ActionId>` +
                  `<Description>${xmlEscape('调用表单操作--' + args.boundOperationName)}</Description>` +
                  `<Id>${xmlEscape(args.formBusinessServiceId)}</Id>` +
                `</FormBusinessService>` +
              `</ClickActions>` +
              `<Caption>${xmlEscape(args.caption)}</Caption>` +
              `<Id>${xmlEscape(args.buttonId)}</Id>` +
              `<Key>${xmlEscape(args.buttonKey)}</Key>` +
            `</BarButtonItem>` +
          `</BarItems>` +
          `<BarItemLinks>` +
            `<BarItemLink>` +
              `<Id>${xmlEscape(args.barItemLinkId)}</Id>` +
              `<BarItemKey>${xmlEscape(args.buttonKey)}</BarItemKey>` +
              `<ParentKey>${xmlEscape(args.toolbarKey)}</ParentKey>` +
            `</BarItemLink>` +
          `</BarItemLinks>` +
        `</BarDataManager>` +
      `</Menu>` +
    `</${args.appearanceKind}>`
  );
}

/* ---------- remove_toolbar_button ---------- */

export function buildRemoveToolbarButtonOverlay(
  appearanceKind: 'FormAppearance' | 'EntryEntityAppearance',
  appearanceOid: string,
  appearanceElementType: number,
  buttonId: string,
  barItemLinkId: string,
): string {
  if (!appearanceOid) throw new Error('appearanceOid required');
  if (!buttonId) throw new Error('buttonId required');
  if (!barItemLinkId) throw new Error('barItemLinkId required');
  return (
    `<${appearanceKind} action="edit" oid="${xmlEscape(appearanceOid)}" ElementType="${appearanceElementType}" ElementStyle="1">` +
      `<Menu>` +
        `<BarDataManager>` +
          `<BarItems>` +
            `<BarButtonItem action="remove" oid="${xmlEscape(buttonId)}" />` +
          `</BarItems>` +
          `<BarItemLinks>` +
            `<BarItemLink action="remove" oid="${xmlEscape(barItemLinkId)}" />` +
          `</BarItemLinks>` +
        `</BarDataManager>` +
      `</Menu>` +
    `</${appearanceKind}>`
  );
}

/**
 * Find a `<FormAppearance ... oid=...>` or `<EntryEntityAppearance ... oid=...>`
 * in a parent-form FKERNELXML, returning {oid, elementType} or null. For
 * entry-level the caller passes an entityKey to disambiguate; the matched
 * appearance's `<Key>` child must equal `entityKey`.
 */
export function extractFormAppearanceLocation(parentKernelXml: string): {
  oid: string;
  elementType: number;
} | null {
  // FormAppearance is the form-level main toolbar container; oid attr is on
  // the appearance node itself, element type is 100 per req-96.
  const m = parentKernelXml.match(/<FormAppearance\b[^>]*\boid="([^"]+)"[^>]*\bElementType="(\d+)"/);
  if (!m) return null;
  return { oid: m[1], elementType: Number(m[2]) };
}

export function extractEntryEntityAppearanceLocation(
  parentKernelXml: string,
  entityKey: string,
): { oid: string; elementType: number } | null {
  // Walk EntryEntityAppearance blocks; match one whose <Key>X</Key> = entityKey.
  const re = /<EntryEntityAppearance\b[^>]*\boid="([^"]+)"[^>]*\bElementType="(\d+)"[\s\S]*?<\/EntryEntityAppearance>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(parentKernelXml)) !== null) {
    if (m[0].includes(`<Key>${entityKey}</Key>`)) {
      return { oid: m[1], elementType: Number(m[2]) };
    }
  }
  return null;
}
