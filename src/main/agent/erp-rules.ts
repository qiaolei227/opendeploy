import type { ErpProvider } from '@shared/erp-types';

/**
 * Per-ERP prompt fragment appended after `base-system.md`. Only the fragment
 * matching the currently active project's ERP gets injected — when no project
 * is active the base rules stand on their own.
 *
 * Rule texts are injected by the caller so this module stays free of Vite
 * `?raw` syntax — production reads them via `?raw` in `ipc-llm.ts`, debug
 * scripts read them via `fs`. Adding a new ERP: drop a new md under
 * `prompts/erp-rules/`, register it in the caller's map, add a case here.
 */
export function erpRulesFragment(
  provider: ErpProvider | undefined,
  rulesByProvider: Partial<Record<ErpProvider, string>>
): string {
  if (!provider) return '';
  const text = rulesByProvider[provider];
  if (!text) return '';
  return text.trim();
}
