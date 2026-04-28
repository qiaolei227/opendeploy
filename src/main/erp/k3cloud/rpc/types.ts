/**
 * Shared types for the K/3 Cloud BOS RPC client.
 *
 * Reflect the wire protocol observed in real BOS Designer captures
 * (.scratch/captures/decoded/req-*) — see memory references:
 *   - bos_save_for_ide_v9_wire_format.md
 *   - bos_dcxml_element_schema.md
 *
 * These types are the *typed AST* that callers build up; the dcxml emitter
 * converts to DCXML strings for the SaveForIDEV9 wire format.
 */

/** Locale IDs observed: 2052=zh-CN, 1033=en-US, 3076=zh-HK. */
export type LocaleId = 2052 | 1033 | 3076;

export interface BosLocalizedString {
  localeId: LocaleId;
  value: string;
}

/** Identity of an extension form (the K/3 Cloud "扩展" object). */
export interface BosExtensionMeta {
  /** GUID; new for first save, persists thereafter. */
  formId: string;
  /** Parent object ID, e.g. "SAL_SaleOrder". */
  baseObjectId: string;
  /** ModelType numeric: 100 = BillModel. */
  modelTypeId: number;
  /** Subsystem id, e.g. "23". */
  subSystemId: string;
  /** Localized extension name (typically inherits parent name unless overridden). */
  name: BosLocalizedString[];
  /** Developer / ISV identity — see bos_dcxml_element_schema.md `ISV / DevCode 来源`. */
  isv: BosIsvIdentity;
  /** Set on rename; null otherwise. */
  oldId?: string | null;
}

export interface BosIsvIdentity {
  /** Locked at app creation in BOS Designer. The user-facing developer code (e.g. "PAIJ"). */
  devCode: string;
  /** Display name; usually equals devCode. */
  name?: string;
  /** Always "Kingdee" for OpenDeploy-managed extensions per observed samples. */
  isvSignal?: string;
  /** Empty unless using a packaged solution. */
  packageSignal?: string;
  /** Equals devCode in observed samples; left independent for future flexibility. */
  id?: string;
}

/**
 * Field types currently supported by the RPC dcxml emitter, with their
 * ElementType numeric codes (BOS internal element registry).
 *
 * Extending: add the new field here, add a case in the dcxml emitter's
 * field-element renderer, and add a snapshot test under tests/erp/rpc/.
 */
export type BosFieldType =
  | 'TextField'           // ElementType=1
  | 'DecimalField'        // ElementType=2
  | 'IntegerField'        // ElementType=3
  | 'DateField'           // ElementType=4
  | 'CheckBoxField'       // ElementType=8
  | 'ComboField'          // ElementType=9
  | 'BaseDataField'       // ElementType=13
  | 'BasePropertyField'   // ElementType=14
  | 'PriceField'          // ElementType=20
  | 'AmountField'         // ElementType=21
  | 'QtyField'            // ElementType=22
  | 'UnitField';          // ElementType=46

export const FIELD_ELEMENT_TYPE: Record<BosFieldType, number> = {
  TextField: 1,
  DecimalField: 2,
  IntegerField: 3,
  DateField: 4,
  CheckBoxField: 8,
  ComboField: 9,
  BaseDataField: 13,
  BasePropertyField: 14,
  PriceField: 20,
  AmountField: 21,
  QtyField: 22,
  UnitField: 46,
};

/**
 * Common fields all element types share. Discriminated unions below add
 * the type-specific extras.
 */
export interface BosFieldCommon {
  /** F_DEV_xxx (case-sensitive entity property name). Equals XML <Key>. */
  key: string;
  /** Field display caption (used by appearance Caption + element Name). */
  caption: string;
  /**
   * Server-managed sequence index; BOS Designer increments per save. Pass
   * a value that's strictly greater than any previously-used index for
   * this extension to avoid collisions.
   */
  listTabIndex: number;
  /** Optional explicit element ID; auto-generated GUID if omitted. */
  id?: string;
  /**
   * Set when the field belongs to an EntryEntity (single-level entry / 单据体).
   * Renders as `<EntityKey>{value}</EntityKey>` after `<PropertyName>` in the
   * field element body. The matching appearance must also carry `entityKey`
   * so the renderer skips Container/Top/Left/ZOrderIndex (entry-fields are
   * grid columns positioned by EntryEntityAppearance, not free-form).
   */
  entityKey?: string;
}

export type BosFieldElement =
  | (BosFieldCommon & { type: 'TextField' })
  | (BosFieldCommon & { type: 'IntegerField' })
  | (BosFieldCommon & { type: 'DateField' })
  | (BosFieldCommon & { type: 'DecimalField'; fieldScale: number; fieldPrecision: number })
  | (BosFieldCommon & { type: 'PriceField'; fieldScale: number; fieldPrecision: number })
  | (BosFieldCommon & { type: 'AmountField'; fieldScale: number; fieldPrecision: number })
  | (BosFieldCommon & {
      type: 'QtyField';
      fieldScale: number;
      fieldPrecision: number;
      controlFieldKey: string; // associated UnitField key
    })
  | (BosFieldCommon & { type: 'CheckBoxField'; defaultCondition?: 0 | 1 })
  | (BosFieldCommon & {
      type: 'ComboField';
      enumTypeId: string; // T_META_FORMENUM GUID
      defaultCondition?: number;
    })
  | (BosFieldCommon & {
      type: 'BaseDataField';
      lookUpObjectId: string; // BD_xxx referenced object's GUID (NOT the friendly key)
      srcFindFieldName?: string; // default "FNUMBER"
      srcDisplayFieldName?: string; // default "FNAME"
    })
  | (BosFieldCommon & {
      type: 'BasePropertyField';
      controlFieldKey: string; // parent base data field key (e.g. "FCustId")
      srcDisplayFieldName?: string; // default "FName" (note casing)
      defaultCondition?: number; // observed = 67
    })
  | (BosFieldCommon & {
      type: 'UnitField';
      unitTypeKey: string;
      lookUpObjectId: string; // BD_UnitGroup GUID
    });

export interface BosFieldAppearance {
  type: BosFieldType;
  /** Matches the corresponding BosFieldElement.key. */
  key: string;
  caption: string;
  /** Tab navigation order. For entry-fields this is per-entry (1-based). */
  tabindex: number;
  /**
   * Set when the field is an entry-field (column inside an EntryEntity).
   * When set, the renderer:
   *   - emits `<EntityKey>{value}</EntityKey>` after ListDefaultWidth
   *   - SKIPS Container / Top / Left / ZOrderIndex (positioning comes from
   *     the parent EntryEntityAppearance, not the cell)
   *   - defaults Width to 150 (vs 280 for head fields) to fit grid columns
   * MUST be paired with the same `entityKey` on the field element.
   */
  entityKey?: string;
  /**
   * Tab page / container ID, e.g. "FTAB_P0". Required for head fields,
   * IGNORED when `entityKey` is set.
   */
  container?: string;
  /** Order within container (visual). Required for head fields, IGNORED for entry-fields. */
  zOrderIndex?: number;
  /** Pixel position. Required for head fields, IGNORED for entry-fields. */
  left?: number;
  top?: number;
  /** Default 280 for head fields, 150 for entry-fields. */
  width?: number;
  /** Default 100. */
  labelWidth?: number;
  /** Default 100. */
  listDefaultWidth?: number;
  /** Bitmask, default 1023 = all states visible. */
  visible?: number;
  /** Default 100. */
  visibleExt?: number;
  /** Optional explicit appearance ID; auto-generated GUID if omitted. */
  id?: string;
  // DateField only:
  mask?: string;
  displayFormatString?: string;
}

// ─── Entry / Tab elements (Plan 5.14) ─────────────────────────────────

/**
 * Single-level EntryEntity (a 单据体 / detail entity). Plan 5.14 supports
 * single-level only — SubEntryEntity (nested) intentionally not modeled.
 *
 * Wire format reference: memory `bos_entry_creation_wire_format.md`.
 *
 * BOS Designer's naming convention:
 *   entryName = `<DevCode>_Cust_Entry<int>`     (e.g. UNW_Cust_Entry100002)
 *   tableName = `<DevCode>_t_Cust_Entry<int>`   (e.g. UNW_t_Cust_Entry100002)
 *   key       = `F_<DevCode>_Entity_<3 char>`   (e.g. F_UNW_Entity_rnk)
 * The `<int>` is allocated via `BusinessDataService.GetSequenceInt32`
 * with category `t_BOS_CustEntry`.
 */
export interface BosEntryElement {
  /** EntityKey — used by child fields' `<EntityKey>`. */
  key: string;
  /** zh-CN display name (set by user). */
  name: string;
  /** ORM internal name. */
  entryName: string;
  /** SQL table name. BOS server creates the actual table from this. */
  tableName: string;
  /** Position within the form's entry list — `parent.entries.count + ext.entries.count + 1`. */
  seq: number;
  /** Compact 32-hex GUID. Auto-generated if omitted. */
  id?: string;
  /** Dashed GUID for the GroupColumnInfo nested Id. Auto-generated if omitted. */
  groupColumnInfoId?: string;
  /** Default "FEntryID" — BOS convention. */
  entryPkFieldName?: string;
}

/** Visual placement for an EntryEntity. Goes inside `<Appearances>`. */
export interface BosEntryAppearance {
  /** Matches BosEntryElement.key. */
  key: string;
  caption: string;
  /** Parent TabPage Key (entry must live inside a TabPage). */
  container: string;
  /** Default 100. */
  pageRows?: number;
  /** Default 5 (Fill). */
  dock?: number;
  left?: number;
  top?: number;
  /** Default 300. */
  width?: number;
  /** Default 65. */
  height?: number;
  id?: string;
}

/** TabControl is the parent UI container that holds N TabPages. */
export interface BosTabControlAppearance {
  key: string;
  caption: string;
  /** Where the TabControl itself sits — typically "FSPLITECONTAINER~Panel2". */
  container: string;
  id?: string;
}

/** A single TabPage. */
export interface BosTabPageAppearance {
  key: string;
  caption: string;
  /** Parent TabControl key (e.g. "FTab1" for original-vendor entry-side, or
   * a self-built "F_<DevCode>_Tab_<3 char>"). */
  container: string;
  /** Optional zero-based index within the parent TabControl. */
  pageIndex?: number;
  id?: string;
}

/** A field/element to drop from the extension's metadata graph. */
export interface BosRemoveElement {
  /** Tag name in DCXML. e.g. "TextField", "SubEntryEntity". */
  tagName: string;
  /** Original field's identity attribute (oid). */
  oid: string;
}

/**
 * One form plugin registration. Renders inside `<Form>` (NOT as a sibling) —
 * specifically inside a `<FormPlugins>` wrapper. Verified 2026-04-27 capture
 * req-75: server accepts this shape and returns IsSuccess=true.
 *
 *   <Form action="edit" ...>
 *     <Id>{formId}</Id>
 *     <FormPlugins>
 *       <PlugIn ElementType="0" ElementStyle="0">
 *         <ClassName>...</ClassName>
 *         <PlugInType>1</PlugInType>
 *         <PyScript><![CDATA[...]]></PyScript>
 *       </PlugIn>
 *     </FormPlugins>
 *   </Form>
 *
 * Order matters — observed captures put ClassName before PlugInType before
 * PyScript, and the server appears strict about it.
 */
export interface BosPluginElement {
  /**
   * For Python plugins: the user-facing script name (e.g. "credit_warn").
   * Lower-snake-case by convention; BOS Designer doesn't enforce.
   */
  className: string;
  /** 1 = Python (inline script via PyScript); 0/absent = DLL (not yet supported). */
  type: 'python';
  /** IronPython 2.7 source. CDATA-wrapped on the wire to avoid XML escaping. */
  pyScript: string;
}

/** Top-level shape of one SaveForIDEV9 invocation. */
export interface SaveExtensionRequest {
  extension: BosExtensionMeta;
  /** True for the first save (no prior extension row); false thereafter. */
  isNew: boolean;
  addFields?: BosFieldElement[];
  removeFields?: BosRemoveElement[];
  addAppearances?: BosFieldAppearance[];
  /** Plugins to register on this Form. Rendered inside `<Form><FormPlugins>...`. */
  addPlugins?: BosPluginElement[];
  /** New EntryEntity elements (单据体). Rendered inside `<Elements>`. */
  addEntries?: BosEntryElement[];
  /** EntryEntity placements. Rendered inside `<Appearances>`. */
  addEntryAppearances?: BosEntryAppearance[];
  /** New TabPage placements. Rendered inside `<Appearances>`. */
  addTabPages?: BosTabPageAppearance[];
  /** New TabControl placements. Rendered inside `<Appearances>`. */
  addTabControls?: BosTabControlAppearance[];
  /**
   * Pre-serialized chunks of the extension's currently-saved fields (typically
   * obtained via `extractExistingExtensionElements`). DCXML is a baseline
   * diff: every save must re-include all elements the extension already owns,
   * or the server treats their absence as removal. Emitted ahead of
   * `addFields` so element order matches the natural read-back ordering.
   */
  existingFieldsRaw?: string[];
  /** Same baseline-diff requirement as existingFieldsRaw, for appearances. */
  existingAppearancesRaw?: string[];
  /** Same baseline-diff requirement as existingFieldsRaw, for plugins. CDATA-preserved. */
  existingPluginsRaw?: string[];
  /** Same baseline-diff requirement, for EntryEntity elements. */
  existingEntriesRaw?: string[];
  /** Same baseline-diff requirement, for EntryEntityAppearance entries. */
  existingEntryAppearancesRaw?: string[];
  /** Same baseline-diff requirement, for TabPageAppearance entries. */
  existingTabPagesRaw?: string[];
  /** Same baseline-diff requirement, for TabControlAppearance entries. */
  existingTabControlsRaw?: string[];
  /**
   * Existing layout's oid in the parent object. Required for non-new
   * extensions. Each Save creates / edits this single LayoutInfo node.
   */
  layoutInfoOid: string;
}

/**
 * What the RPC client returns to callers after a SaveForIDEV9 round-trip.
 * Mirrors the `IDEOperateResult` JSON we observed in capture decode.
 */
export interface SaveExtensionResult {
  isSuccess: boolean;
  funcResult: boolean;
  messageTitle?: string | null;
  messageDetail?: string | null;
}
