/**
 * Returns the platform-appropriate modifier-key label for display in
 * keyboard shortcut hints.
 *
 * - macOS → `⌘`
 * - Windows / Linux / other → `Ctrl`
 *
 * Uses `navigator.userAgent` (stable, non-deprecated) over
 * `navigator.platform` (deprecated) to make the detection.
 *
 * The value is fixed for the lifetime of the renderer — users don't
 * change OS at runtime — so this is a plain function rather than a hook.
 */
export function getModKey(): '⌘' | 'Ctrl' {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isMac ? '⌘' : 'Ctrl';
}
