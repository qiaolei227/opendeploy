/**
 * Cross-process ERP types. Mirrors the split seen in llm-types.ts:
 * data contracts live here; behavioral interfaces (ErpConnector) live in
 * `src/main/erp/types.ts` so they can reference Node-only symbols freely.
 */

/**
 * ERP product family identifier. The product is the only product-level
 * discriminator — edition/version are not modeled because the K3CloudConnector
 * works identically across V9/V10 and standard/enterprise. Future products
 * (e.g. `'sap'`) each bring their own connection-config shape.
 */
export type ErpProvider = 'k3cloud';

export interface K3CloudConnectionConfig {
  /** Hostname or IP. Loopback for local dev, FQDN / IP for customer environments. */
  server: string;
  /** Defaults to 1433 when omitted. Dynamic-port instances need an explicit value. */
  port?: number;
  /** Target account-set database — the `AIS...` one for K/3 Cloud. */
  database: string;
  user: string;
  /** Stored plaintext in settings.json per project decision; Enterprise build will move to keychain. */
  password: string;
  /** Default `true` — SQL Server 2022+ requires encryption. */
  encrypt?: boolean;
  /** Default `true` for local dev; flip off when the DB has a CA-issued cert. */
  trustServerCertificate?: boolean;
}

/**
 * Connection parameters needed to enumerate candidate account-set databases
 * on a K/3 Cloud server — i.e. everything needed to log in to `master`.
 * `database` is deliberately excluded: the discovery flow runs *before*
 * the user has picked a database.
 */
export interface K3CloudDiscoveryConfig {
  server: string;
  port?: number;
  user: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export interface DatabaseCandidate {
  /** `name` from `sys.databases`. */
  name: string;
  /** True when the name matches K/3 Cloud's `AIS*` account-set convention. */
  isAccountSet: boolean;
}

export interface ListDatabasesResult {
  ok: boolean;
  /** Present on success — user-visible databases, account-sets sorted first. */
  databases?: DatabaseCandidate[];
  /**
   * `@@VERSION` output from the server, e.g. "Microsoft SQL Server 2022 …".
   * The discovery flow probes this alongside `sys.databases` so the UI can
   * show a "connected" confirmation without a second round-trip.
   */
  serverVersion?: string;
  /** Present on failure — human-readable reason. */
  error?: string;
}

export interface Project {
  id: string;
  name: string;
  erpProvider: ErpProvider;
  connection: K3CloudConnectionConfig;
  /** ISO timestamps; written by the store on create / update. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight liveness state published to the renderer for StatusBar / NavRail.
 * Does not include error details the user shouldn't see in the status chip —
 * those land on the Projects page.
 */
export interface ErpConnectionState {
  projectId: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error?: string;
  lastTestedAt?: string;
  /**
   * ERP product of the active project. Present whenever `projectId` is set
   * (even during `connecting` / `error`), so callers like the skill-catalog
   * builder can pick the right namespace bucket without waiting for the
   * pool to come up.
   */
  erpProvider?: ErpProvider;
}

export interface TestConnectionResult {
  ok: boolean;
  /** `@@VERSION` output, e.g. "Microsoft SQL Server 2025 Express ...". Present on success. */
  serverVersion?: string;
  /** Human-readable reason for failure. Populated when `ok === false`. */
  error?: string;
}

// ─── Metadata query result types ────────────────────────────────────────
// Fleshed out during Task 12 once the SQL + XML parse are concrete.
// Keeping rich shapes here so the IPC layer can type-check without waiting.

/** A K/3 Cloud business object (FormId + localized name + subsystem). */
export interface ObjectMeta {
  /** `FID` in T_META_OBJECTTYPE — the stable identifier used everywhere. */
  id: string;
  /** `FNAME` from T_META_OBJECTTYPE_L at the caller's locale, or the id when missing. */
  name: string;
  /** `FMODELTYPEID` — coarse type code (1400 = mobile form, etc). */
  modelTypeId: number | null;
  /** `FSUBSYSID` → T_META_SUBSYSTEM.FID. */
  subsystemId: string | null;
  /** Whether this is a template / base object (usually hidden from consultants). */
  isTemplate: boolean;
  /** `FMODIFYDATE`. ISO string. */
  modifyDate: string | null;
}

/** Field descriptor produced by XML-parsing `T_META_OBJECTTYPE.FKERNELXML`. */
export interface FieldMeta {
  /** Element key (`FFieldKey`), e.g. "FCustomerId". */
  key: string;
  /** Display name resolved via its `_L`-equivalent node, when present. */
  name: string;
  /** Field element type from XML, e.g. "BasedataField", "TextField", "DecimalField". */
  type: string;
  /** Whether the field belongs to a detail/entry table rather than the bill head. */
  isEntryField: boolean;
  /** When `isEntryField`, the enclosing entity key (`FEntityKey`). */
  entryKey?: string;
}

export interface SubsystemMeta {
  id: string;
  /** `FNUMBER` from T_META_SUBSYSTEM — mnemonic like "SAL", "PUR", "STK". */
  number: string;
  /** Localized display name via `_L`. */
  name: string;
}

// ─── BOS extension / plugin types (Plan 5.5) ──────────────────────────

/**
 * A user-created extension of a base form (e.g. a SAL_SaleOrder extension).
 * Identified by a GUID in `T_META_OBJECTTYPE.FID`, linked to its parent
 * via `FBASEOBJECTID`. All customizations (fields, plugins, layout) attach
 * to the extension — the base form's metadata stays untouched.
 */
export interface ExtensionMeta {
  /** `FID` in T_META_OBJECTTYPE — GUID form. */
  extId: string;
  /** `FBASEOBJECTID` — the form this extension inherits from. */
  parentFormId: string;
  /** Localized extension name from T_META_OBJECTTYPE_L at `FLOCALEID=2052`. */
  name: string;
  /** `FSUPPLIERNAME` — developer code, e.g. "PAIJ". Extensions with mismatched code can't be edited in BOS Designer. */
  developerCode: string | null;
  /** `FMODIFYDATE`. ISO string. */
  modifyDate: string | null;
}

/**
 * A single plugin registration inside a form's `<FormPlugins>` XML block.
 * Covers both .NET DLL plugins and inline Python plugins — the shape
 * differs as documented on the fields.
 */
export interface PluginMeta {
  /**
   * Python plugins: the user-given script name (e.g. "credit_limit_guard").
   * DLL plugins: full .NET type + assembly (e.g. "Kingdee.K3.SCM.Sal.Business.PlugIn.SaleOrderEdit, Kingdee.K3.SCM.Sal.Business.PlugIn").
   */
  className: string;
  /** `<PlugInType>` — 1 = Python (inline script); absent/0 = DLL. */
  type: 'python' | 'dll';
  /** Only for Python plugins — the inline IronPython source. */
  pyScript?: string;
  /** `<OrderId>` — DLL plugins have one; Python plugins omit (per BOS UI "插件之间并没有执行顺序"). */
  orderId?: number;
}

/**
 * Result of probing the database for a usable BOS development environment.
 * Reduced to a connectivity + read-permission check: can we SELECT from
 * `T_META_OBJECTTYPE`? Writes stamp `FMODIFIERID=0` + `FSUPPLIERNAME=NULL`
 * and don't need a per-user developer code (2026-04-23 UAT 实证 — see
 * memory `fuserid_not_required`).
 */
export interface BosEnvironmentStatus {
  /** `ready` when we can safely write extensions; `not-initialized` otherwise. */
  status: 'ready' | 'not-initialized';
  /** Human-readable reason when `not-initialized`. */
  reason?: string;
}
