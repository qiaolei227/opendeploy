/**
 * Cross-process types for plugin-file artifacts — the Python code agent
 * produces into a project's `plugins/` directory.
 */

/**
 * The agent-tool name both sides of the IPC filter on when a `write_plugin`
 * result lands. Keeping it here means renaming the tool is a single-file
 * edit, not a silent contract break between main and renderer.
 */
export const WRITE_PLUGIN_TOOL_NAME = 'write_plugin';

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
