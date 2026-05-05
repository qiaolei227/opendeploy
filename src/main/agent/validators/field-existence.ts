/**
 * Field-existence validator for BOS business-rule tools (Plan 5.12.3b Task 3.3).
 *
 * Given a list of field keys an agent is about to ship to the server (e.g.
 * `stockQtyField: 'F_TestQty'` for an entity-level GetInvStock rule) and a
 * pre-loaded schema of every field key the parent + extension know about,
 * verify each referenced key exists. Unknown keys come back with a
 * Levenshtein-ranked "did you mean" suggestion list so the agent has a
 * concrete recovery path instead of a generic "field not found" error.
 *
 * Pure data-in / data-out — no I/O, no connector reference. Caller is
 * responsible for merging extension-delta + parent-form fields into the
 * schema's `fields` array before invoking.
 */

export interface FieldSchema {
  /** Every known field key on the form being targeted (parent + extension delta merged). */
  fields: string[];
}

export interface ValidationError {
  /** The unknown field key the agent passed. */
  field: string;
  /** Up to N nearest matches by Levenshtein distance, closest first. */
  suggestions: string[];
}

export interface ValidationResult {
  ok: boolean;
  /** Present when `ok === false`, one entry per unknown referenced field. */
  errors?: ValidationError[];
}

/**
 * Validate every entry in `referencedFields` exists in `schema.fields`.
 * Empty input → ok. Duplicates in input produce duplicate errors —
 * caller can dedupe upstream if it cares.
 */
export function validateFieldExistence(
  referencedFields: string[],
  schema: FieldSchema,
): ValidationResult {
  const set = new Set(schema.fields);
  const errors: ValidationError[] = [];
  for (const field of referencedFields) {
    if (!set.has(field)) {
      errors.push({
        field,
        suggestions: nearestMatches(field, schema.fields, 3),
      });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function nearestMatches(target: string, candidates: string[], n: number): string[] {
  const scored = candidates.map((c) => ({ c, d: levenshtein(target, c) }));
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, n).map((s) => s.c);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}
