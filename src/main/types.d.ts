/**
 * Main-process ambient declarations.
 *
 * Vite (and by extension electron-vite) lets us import the raw text of any
 * asset with `?raw` — we use this to keep the agent's base system prompt in
 * a real markdown file (`src/main/agent/prompts/base-system.md`) instead of
 * a hard-coded string. Content is inlined as a module at build time, so
 * no runtime fs access is needed in production.
 */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
