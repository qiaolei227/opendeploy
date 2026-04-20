/**
 * Cross-process types for plugin-file artifacts — the Python code agent
 * produces into a project's `plugins/` directory.
 */

export interface PluginFile {
  /** File name relative to the project plugins dir — e.g. "credit_limit_guard.py". */
  name: string;
  /** Absolute on-disk path. Useful for "open in file explorer" affordances. */
  path: string;
  /** ISO timestamp from fs.stat.mtime. */
  modifiedAt: string;
  /** Bytes on disk. */
  size: number;
}

export interface PluginWriteResult {
  projectId: string;
  file: PluginFile;
  /** Line count at write time; drives the agent's natural-language confirmation. */
  lines: number;
  /** True when the write created a new file; false when it overwrote an existing one. */
  created: boolean;
}
