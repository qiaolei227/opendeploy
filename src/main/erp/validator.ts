/**
 * SQL whitelist validator — mount point only (Plan 4).
 *
 * **Release gate (Plan 6)**: the one-line `ok: true` return below MUST be
 * replaced with a real whitelist before v0.1 ships. CLAUDE.md's architecture
 * red line #1 — "产品永不触碰客户业务数据. SQL 访问必须走白名单" — is
 * not satisfied until every query the connector issues has been parsed and
 * restricted to the `T_META_*` / `T_BOS_*` metadata tables we know about.
 *
 * Why defer: at spec time we didn't yet know which tables K/3 Cloud puts
 * metadata in (user's UAT scan revealed T_META_* + T_BOS_* + a few others).
 * Writing a whitelist on assumption would reject legitimate queries and
 * block development. The function stays called from every execute-path in
 * the connector so adding the rules later is a one-file edit.
 *
 * Until then, all queries MUST be parameterized — no string concatenation —
 * so even a lax validator can't open the door to SQL injection.
 */

export interface QueryValidation {
  ok: boolean;
  /** Human-readable reason when rejection happens. Logged and surfaced to UI. */
  reason?: string;
}

export interface ValidatorOptions {
  /**
   * Dev-only override to bypass future whitelist rules. Release builds must
   * reject `devAllowUnsafe: true` outright — gated in Plan 6.
   */
  devAllowUnsafe?: boolean;
}

/**
 * Approve or reject a SQL statement before the connector sends it.
 *
 * MVP behavior: unconditionally returns `{ ok: true }`. Behavior flipping the
 * function body into real rules (table allowlist, AST parse, writes blocked)
 * is tracked as a Plan 6 release gate.
 */
export function validateQuery(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sql: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  opts?: ValidatorOptions
): QueryValidation {
  return { ok: true };
}
