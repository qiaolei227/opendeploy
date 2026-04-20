/**
 * Cross-process ERP types. Mirrors the split seen in llm-types.ts:
 * data contracts live here; behavioral interfaces (ErpConnector) live in
 * `src/main/erp/types.ts` so they can reference Node-only symbols freely.
 */

/**
 * ERP product family identifier. The product's own edition (standard vs
 * enterprise) and release version are *not* part of this id — they live
 * in the project's connection config so the same connector implementation
 * can serve all editions. See memory: `project_plan_4_decisions`.
 */
export type ErpProvider = 'k3cloud';

export type K3CloudEdition = 'standard' | 'enterprise';

/** K/3 Cloud major release, kept as a string so the set can extend without a refactor. */
export type K3CloudVersion = '9' | '10';

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
  edition: K3CloudEdition;
  version: K3CloudVersion;
  /** Default `true` — SQL Server 2022+ requires encryption. */
  encrypt?: boolean;
  /** Default `true` for local dev; flip off when the DB has a CA-issued cert. */
  trustServerCertificate?: boolean;
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
