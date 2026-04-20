/**
 * Plugin filename validator. The `write_plugin` agent tool feeds user-
 * (and LLM-)originated strings here so the write can't escape the project
 * plugins dir, install a non-Python extension, or otherwise behave
 * surprisingly.
 */

export interface FilenameValidation {
  ok: boolean;
  reason?: string;
}

const MAX_LEN = 80;
const PY_RE = /\.py$/;

export function validatePluginFilename(name: unknown): FilenameValidation {
  if (typeof name !== 'string') return { ok: false, reason: 'filename must be a string' };
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, reason: 'filename is empty' };
  if (trimmed.length > MAX_LEN) return { ok: false, reason: `filename is longer than ${MAX_LEN} chars` };
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { ok: false, reason: 'filename may not contain path separators' };
  }
  if (trimmed.startsWith('.')) {
    return { ok: false, reason: 'filename may not start with a dot' };
  }
  if (trimmed.includes('..')) {
    return { ok: false, reason: 'filename may not contain ".."' };
  }
  if (!PY_RE.test(trimmed)) {
    return { ok: false, reason: 'filename must end with .py' };
  }
  // Accept only ASCII letters / digits / _ / - / . — keeps cross-OS compatibility.
  if (!/^[A-Za-z0-9_\-.]+$/.test(trimmed)) {
    return { ok: false, reason: 'filename may only contain ASCII letters, digits, underscore, dash, or dot' };
  }
  return { ok: true };
}
