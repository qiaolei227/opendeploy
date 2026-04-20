/**
 * Short, readable opaque ids with a caller-supplied prefix.
 *
 *   makeId('p')  → "p_LhJ2f3K_7X8y3kZq"
 *   makeId('c')  → "c_LhJ2fAB_p2hJ91rq"
 *
 * Uniqueness comes from `Date.now()` + 8 chars of Math.random. Not
 * cryptographically strong (use crypto for tokens). Good enough for
 * in-memory / on-disk ids whose collision domain is a single user's
 * local state.
 */
export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
