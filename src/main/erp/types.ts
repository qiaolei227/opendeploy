import type {
  ExtensionMeta,
  FieldMeta,
  K3CloudConnectionConfig,
  ObjectMeta,
  PluginMeta,
  SubsystemMeta,
  TestConnectionResult
} from '@shared/erp-types';

/**
 * Behavioral contract every ERP connector implements. Kept in the main-process
 * tree so it can reference Node-only types (timers, streams) later without
 * leaking them across IPC; renderer code only ever sees the `@shared/erp-types`
 * data shapes.
 */
export interface ErpConnector {
  readonly config: K3CloudConnectionConfig;

  /** Open the long-lived pool. Idempotent. */
  connect(): Promise<void>;
  /** Close the long-lived pool. Idempotent. */
  disconnect(): Promise<void>;

  /** Hit the server with a trivial query to confirm connectivity + auth. */
  testConnection(): Promise<TestConnectionResult>;

  // ─── Metadata queries (implemented in Task 12) ────────────────────────

  /** List business objects with optional keyword filter on id/localized name. */
  listObjects(opts?: ListObjectsOptions): Promise<ObjectMeta[]>;
  /** Fetch one object's header info by FID. Returns null when not found. */
  getObject(id: string, locale?: number): Promise<ObjectMeta | null>;
  /** Parse the object's XML and return its field definitions. */
  getFields(formId: string, locale?: number): Promise<FieldMeta[]>;
  /** Enumerate subsystems (modules) visible in this account set. */
  listSubsystems(locale?: number): Promise<SubsystemMeta[]>;
  /** Fuzzy search across id + localized name. */
  searchMetadata(keyword: string, locale?: number): Promise<ObjectMeta[]>;
  /**
   * Raw `T_META_OBJECTTYPE.FKERNELXML` for `formId`, used by BOS write tools
   * to discover layout view OIDs for the LayoutInfo delta. Returns null when
   * the form doesn't exist.
   */
  getKernelXml(formId: string): Promise<string | null>;
  /**
   * List BOS extensions whose parent is `parentFormId`. Joins
   * `T_META_OBJECTTYPE_E` so only genuine extensions surface, not stray rows
   * pointing at the parent.
   */
  listExtensions(parentFormId: string, locale?: number): Promise<ExtensionMeta[]>;
  /**
   * Parse the form (or extension) FKERNELXML and return registered plugins.
   * Distinguishes `python` (PyScript inline) from `dll` (.NET fully-qualified
   * ClassName).
   */
  listFormPlugins(formOrExtId: string): Promise<PluginMeta[]>;
}

export interface ListObjectsOptions {
  /** Match against FID and FNAME (localized). */
  keyword?: string;
  /** 2052 = zh-CN, 1033 = en-US. Defaults to 2052. */
  locale?: number;
  /** Filter by T_META_SUBSYSTEM.FID. */
  subsystemId?: string;
  /** When false, hide FISTEMPLATE=1 rows. Defaults false. */
  includeTemplates?: boolean;
  /** Page size. Defaults 200. */
  limit?: number;
}
