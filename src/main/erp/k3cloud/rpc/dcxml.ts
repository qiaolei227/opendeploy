/**
 * BOS DCXML emitter — typed AST → SaveForIDEV9 ap0.__source__ string.
 *
 * Wire format reference: `.scratch/captures/decoded/req-*` real captures.
 * Schema reference: memory `bos_dcxml_element_schema.md`.
 *
 * Output structure (skipping declared but empty sections for brevity):
 *
 *   <?xml version="1.0" encoding="utf-16"?>
 *   <FormMetadata>
 *     <BusinessInfo><BusinessInfo><Elements>
 *       <Form action="edit" oid="BOS_BillModel" ElementType="100">
 *         <Id>{formId}</Id>
 *       </Form>
 *       {addFields rendered with no action attr (= add)}
 *       {removeFields rendered with action="remove" oid=...}
 *     </Elements></BusinessInfo></BusinessInfo>
 *     <LayoutInfos><LayoutInfo action="edit" oid="{layoutInfoOid}">
 *       <Appearances>
 *         {addAppearances rendered with type-specific extras}
 *       </Appearances>
 *     </LayoutInfo></LayoutInfos>
 *   </FormMetadata>
 *
 * Empirical: server SaveForIDEV9 accepts utf-8 bytes regardless of the
 * `encoding="utf-16"` declaration in the XML prolog (BOS XmlTextWriter
 * default). We emit utf-8 with the matching declaration to byte-match
 * original samples.
 */

import {
  BosFieldElement,
  BosFieldAppearance,
  BosPluginElement,
  BosRemoveElement,
  BosEntryElement,
  BosEntryAppearance,
  BosTabPageAppearance,
  BosTabControlAppearance,
  SaveExtensionRequest,
  FIELD_ELEMENT_TYPE,
} from './types';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 32-char hex GUID (no dashes) — matches BOS Designer's <Id> shape. */
export function newCompactGuid(): string {
  // Cheap GUID: random hex without dashes. crypto.randomUUID gives dashed,
  // strip them. Available without import in Node 19+.
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

/** Standard 8-4-4-4-12 dashed GUID — for layoutInfoOid etc. */
export function newDashedGuid(): string {
  return globalThis.crypto.randomUUID();
}

interface XmlWriter {
  push(s: string): void;
}

/** Render a child like `<Tag>value</Tag>`. Skips when value is undefined. */
function child(out: XmlWriter, tag: string, value: string | number | undefined): void {
  if (value === undefined || value === null) return;
  out.push(`<${tag}>${typeof value === 'string' ? xmlEscape(value) : value}</${tag}>`);
}

function renderFormRoot(
  out: XmlWriter,
  formId: string,
  plugins: BosPluginElement[] | undefined,
  existingPluginsRaw: string[] | undefined,
): void {
  out.push(`<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">`);
  out.push(`<Id>${formId}</Id>`);
  const hasExisting = existingPluginsRaw && existingPluginsRaw.length > 0;
  const hasNew = plugins && plugins.length > 0;
  if (hasExisting || hasNew) {
    out.push(`<FormPlugins>`);
    if (hasExisting) for (const raw of existingPluginsRaw!) out.push(raw);
    if (hasNew) for (const p of plugins!) renderPluginElement(out, p);
    out.push(`</FormPlugins>`);
  }
  out.push(`</Form>`);
}

/**
 * Render a single `<PlugIn ElementType="0" ElementStyle="0">` block. Order
 * matches captured req-75: ClassName → PlugInType → PyScript. PyScript wraps
 * the body in CDATA so script content with `<` / `>` / `&` flows through
 * without XML escaping.
 *
 * Note: capture only confirmed Python (PlugInType=1). DLL plugins use
 * PlugInType=0 with the .NET fully-qualified type as ClassName and an
 * `<OrderId>` child — not yet supported here.
 */
function renderPluginElement(out: XmlWriter, p: BosPluginElement): void {
  out.push(`<PlugIn ElementType="0" ElementStyle="0">`);
  child(out, 'ClassName', p.className);
  out.push(`<PlugInType>${p.type === 'python' ? 1 : 0}</PlugInType>`);
  // CDATA — never escape; rely on the rare `]]>` substring case to be
  // accidental in user-given scripts. If it ever becomes a real problem
  // we'll split the CDATA section, but Python doesn't naturally produce
  // `]]>` so this is fine for now.
  out.push(`<PyScript><![CDATA[${p.pyScript}]]></PyScript>`);
  out.push(`</PlugIn>`);
}

/**
 * Render one field element with its baseline + type-specific children.
 * Order matches what BOS Designer emits (we match for byte-level diff
 * stability against captures).
 *
 * EntityKey injection: when `f.entityKey` is set (i.e. the field belongs to
 * an EntryEntity / 单据体), `<EntityKey>{entityKey}</EntityKey>` is rendered
 * immediately after `<PropertyName>`, preserving the BOS Designer-emitted
 * order. Implemented as a post-write rewrite to keep each type's
 * type-specific child order intact without duplicating switch arms.
 */
function renderFieldElement(out: XmlWriter, f: BosFieldElement): void {
  const elemType = FIELD_ELEMENT_TYPE[f.type];
  const id = f.id ?? newCompactGuid();

  // Capture this field's children into a local writer so we can splice the
  // EntityKey directly after PropertyName regardless of type-specific order.
  const inner: string[] = [];
  const innerOut: XmlWriter = { push: (s) => inner.push(s) };

  // Render order: type-specific prefix → common prefix → name/id/key suffix.
  // Captured samples follow this rough shape, e.g. BaseDataField puts
  // LookUpObjectID before PropertyName; ComboField puts EnumType first.
  switch (f.type) {
    case 'TextField':
    case 'IntegerField':
    case 'DateField': {
      child(innerOut, 'ConditionType', 0);
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'FieldName', f.key.toUpperCase());
      break;
    }
    case 'DecimalField':
    case 'PriceField':
    case 'AmountField': {
      child(innerOut, 'ConditionType', 0);
      child(innerOut, 'FieldScale', f.fieldScale);
      child(innerOut, 'FieldPrecision', f.fieldPrecision);
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'FieldName', f.key.toUpperCase());
      break;
    }
    case 'QtyField': {
      child(innerOut, 'ConditionType', 0);
      child(innerOut, 'FieldScale', f.fieldScale);
      child(innerOut, 'FieldPrecision', f.fieldPrecision);
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'ControlFieldKey', f.controlFieldKey);
      child(innerOut, 'FieldName', f.key.toUpperCase());
      break;
    }
    case 'CheckBoxField': {
      child(innerOut, 'Editlen', 20);
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'FieldName', f.key.toUpperCase());
      child(innerOut, 'ConditionType', 0);
      child(innerOut, 'DefaultCondition', f.defaultCondition ?? 0);
      break;
    }
    case 'ComboField': {
      child(innerOut, 'EnumType', f.enumTypeId);
      child(innerOut, 'Editlen', 20);
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'FieldName', f.key.toUpperCase());
      child(innerOut, 'FieldType', 167);
      child(innerOut, 'ConditionType', 5);
      child(innerOut, 'DefaultCondition', f.defaultCondition ?? 0);
      break;
    }
    case 'BaseDataField': {
      child(innerOut, 'ConditionType', 0);
      child(innerOut, 'AllowEditGroup', 0);
      child(innerOut, 'LookUpObjectID', f.lookUpObjectId);
      child(innerOut, 'SrcFindFieldName', f.srcFindFieldName ?? 'FNUMBER');
      child(innerOut, 'SrcDisplayFieldName', f.srcDisplayFieldName ?? 'FNAME');
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'FieldName', f.key.toUpperCase());
      child(innerOut, 'FieldType', 56);
      break;
    }
    case 'BasePropertyField': {
      // BasePropertyField is unique: NO FieldName, NO FieldType.
      child(innerOut, 'SrcDisplayFieldName', f.srcDisplayFieldName ?? 'FName');
      child(innerOut, 'DefaultCondition', f.defaultCondition ?? 67);
      child(innerOut, 'ConditionType', 0);
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'ControlFieldKey', f.controlFieldKey);
      break;
    }
    case 'UnitField': {
      child(innerOut, 'UnitTypeKey', f.unitTypeKey);
      child(innerOut, 'ConditionType', 0);
      child(innerOut, 'LookUpObjectID', f.lookUpObjectId);
      child(innerOut, 'PropertyName', f.key);
      child(innerOut, 'FieldName', f.key.toUpperCase());
      child(innerOut, 'FieldType', 127);
      break;
    }
  }

  child(innerOut, 'ListTabIndex', f.listTabIndex);
  child(innerOut, 'Name', f.caption);
  child(innerOut, 'Id', id);
  child(innerOut, 'Key', f.key);

  out.push(`<${f.type} ElementType="${elemType}" ElementStyle="0">`);
  if (f.entityKey) {
    // Splice <EntityKey>...</EntityKey> immediately after the first
    // <PropertyName>...</PropertyName>, matching captured entry-field shape.
    const propTag = `<PropertyName>${xmlEscape(f.key)}</PropertyName>`;
    let spliced = false;
    for (const piece of inner) {
      out.push(piece);
      if (!spliced && piece === propTag) {
        out.push(`<EntityKey>${xmlEscape(f.entityKey)}</EntityKey>`);
        spliced = true;
      }
    }
  } else {
    for (const piece of inner) out.push(piece);
  }
  out.push(`</${f.type}>`);
}

function renderRemoveElement(out: XmlWriter, r: BosRemoveElement): void {
  out.push(`<${r.tagName} action="remove" oid="${xmlEscape(r.oid)}" />`);
}

function renderAppearance(out: XmlWriter, a: BosFieldAppearance): void {
  const elemType = FIELD_ELEMENT_TYPE[a.type];
  const tag = `${a.type}Appearance`;
  const id = a.id ?? newCompactGuid();
  const isEntryField = !!a.entityKey;
  out.push(`<${tag} ElementType="${elemType}" ElementStyle="1">`);

  // BasePropertyFieldAppearance unique: <Locked>-1</Locked> at the front.
  if (a.type === 'BasePropertyField') {
    out.push(`<Locked>-1</Locked>`);
  }
  // CheckBoxField has no EmptyText; everyone else does.
  if (a.type !== 'CheckBoxField') {
    out.push(`<EmptyText action="setnull" />`);
  }
  child(out, 'Key', a.key);
  // DateField has Mask + DisplayFormatString right after Key.
  if (a.type === 'DateField') {
    child(out, 'Mask', a.mask);
    child(out, 'DisplayFormatString', a.displayFormatString);
  }
  child(out, 'ListDefaultWidth', a.listDefaultWidth ?? 100);
  if (isEntryField) {
    // Entry-field cells are positioned by the parent EntryEntityAppearance,
    // not absolute coords — emit EntityKey + Tabindex + size, omit
    // Container / ZOrderIndex / Left / Top.
    out.push(`<EntityKey>${xmlEscape(a.entityKey!)}</EntityKey>`);
    child(out, 'Tabindex', a.tabindex);
  } else {
    child(out, 'Container', a.container);
    child(out, 'ZOrderIndex', a.zOrderIndex);
    child(out, 'Tabindex', a.tabindex);
    child(out, 'Left', a.left);
    child(out, 'Top', a.top);
  }
  child(out, 'LabelWidth', a.labelWidth ?? 100);
  child(out, 'Width', a.width ?? (isEntryField ? 150 : 300));
  child(out, 'Visible', a.visible ?? 1023);
  child(out, 'VisibleExt', a.visibleExt ?? 100);
  child(out, 'Caption', a.caption);
  child(out, 'Id', id);
  out.push(`</${tag}>`);
}

/**
 * Render an EntryEntity element. Goes inside `<Elements>`.
 *
 * Element child order observed in capture (req #1334 etc.):
 *   ConditionType=0 → EntryName → EntryPkFieldName → Seq → TableName →
 *   GroupColumnInfo → Name → Id → Key
 */
function renderEntryEntity(out: XmlWriter, e: BosEntryElement): void {
  const id = e.id ?? newCompactGuid();
  const groupId = e.groupColumnInfoId ?? newDashedGuid();
  out.push(`<EntryEntity ElementType="35" ElementStyle="0">`);
  child(out, 'ConditionType', 0);
  child(out, 'EntryName', e.entryName);
  child(out, 'EntryPkFieldName', e.entryPkFieldName ?? 'FEntryID');
  child(out, 'Seq', e.seq);
  child(out, 'TableName', e.tableName);
  out.push(
    `<GroupColumnInfo><GroupColumnInfo><Id>${xmlEscape(groupId)}</Id></GroupColumnInfo></GroupColumnInfo>`,
  );
  child(out, 'Name', e.name);
  child(out, 'Id', id);
  child(out, 'Key', e.key);
  out.push(`</EntryEntity>`);
}

/**
 * Render an EntryEntityAppearance. Goes inside `<Appearances>`.
 *
 * Defaults (BOS Designer's first-save shape): PageRows=100, Dock=5 (Fill),
 * Width=300, Height=65.
 */
function renderEntryEntityAppearance(out: XmlWriter, a: BosEntryAppearance): void {
  const id = a.id ?? newCompactGuid();
  out.push(`<EntryEntityAppearance ElementType="35" ElementStyle="1">`);
  child(out, 'Key', a.key);
  child(out, 'PageRows', a.pageRows ?? 100);
  child(out, 'Dock', a.dock ?? 5);
  child(out, 'Container', a.container);
  child(out, 'Left', a.left);
  child(out, 'Top', a.top);
  child(out, 'Height', a.height ?? 65);
  child(out, 'Width', a.width ?? 300);
  child(out, 'Caption', a.caption);
  child(out, 'Id', id);
  out.push(`</EntryEntityAppearance>`);
}

/** Render a self-built TabControlAppearance. ElementType=1005. */
function renderTabControlAppearance(out: XmlWriter, a: BosTabControlAppearance): void {
  const id = a.id ?? newCompactGuid();
  out.push(`<TabControlAppearance ElementType="1005" ElementStyle="1">`);
  child(out, 'Key', a.key);
  child(out, 'Container', a.container);
  child(out, 'Caption', a.caption);
  child(out, 'Id', id);
  out.push(`</TabControlAppearance>`);
}

/** Render a TabPageAppearance under a TabControl. ElementType=1004. */
function renderTabPageAppearance(out: XmlWriter, a: BosTabPageAppearance): void {
  const id = a.id ?? newCompactGuid();
  out.push(`<TabPageAppearance ElementType="1004" ElementStyle="1">`);
  child(out, 'Key', a.key);
  child(out, 'Container', a.container);
  child(out, 'PageIndex', a.pageIndex);
  child(out, 'Caption', a.caption);
  child(out, 'Id', id);
  out.push(`</TabPageAppearance>`);
}

/** Build the SaveForIDEV9 ap0.__source__ DCXML string. */
export function buildDcxmlSource(req: SaveExtensionRequest): string {
  const parts: string[] = [];
  const out: XmlWriter = { push: (s) => parts.push(s) };

  out.push(`<?xml version="1.0" encoding="utf-16"?>`);
  out.push(`<FormMetadata>`);
  out.push(`<BusinessInfo><BusinessInfo><Elements>`);
  renderFormRoot(out, req.extension.formId, req.addPlugins, req.existingPluginsRaw);
  for (const raw of req.existingFieldsRaw ?? []) out.push(raw);
  for (const f of req.addFields ?? []) renderFieldElement(out, f);
  for (const raw of req.existingEntriesRaw ?? []) out.push(raw);
  for (const e of req.addEntries ?? []) renderEntryEntity(out, e);
  for (const r of req.removeFields ?? []) renderRemoveElement(out, r);
  out.push(`</Elements></BusinessInfo></BusinessInfo>`);
  out.push(`<LayoutInfos><LayoutInfo action="edit" oid="${xmlEscape(req.layoutInfoOid)}">`);
  out.push(`<Appearances>`);
  for (const raw of req.existingAppearancesRaw ?? []) out.push(raw);
  for (const a of req.addAppearances ?? []) renderAppearance(out, a);
  for (const raw of req.existingTabControlsRaw ?? []) out.push(raw);
  for (const a of req.addTabControls ?? []) renderTabControlAppearance(out, a);
  for (const raw of req.existingTabPagesRaw ?? []) out.push(raw);
  for (const a of req.addTabPages ?? []) renderTabPageAppearance(out, a);
  for (const raw of req.existingEntryAppearancesRaw ?? []) out.push(raw);
  for (const a of req.addEntryAppearances ?? []) renderEntryEntityAppearance(out, a);
  out.push(`</Appearances>`);
  out.push(`</LayoutInfo></LayoutInfos>`);
  out.push(`</FormMetadata>`);

  return parts.join('');
}
