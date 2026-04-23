/**
 * Ordered stream blocks for an assistant message — preserves the interleaving
 * of text deltas and tool_use events as they arrived from the LLM stream, so
 * the UI can render them in causal order (say X → do tool → say Y → do tool)
 * instead of lumping all text before all tools.
 *
 * tool_use blocks reference the ToolCall by id; the renderer looks the call
 * up in message.toolCalls[] to draw the card (and its result, once it lands).
 */
export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; callId: string };

/**
 * Append a text delta. If the last block is text, extend its text; otherwise
 * start a fresh text block. Treats empty delta as a no-op (returns the same
 * reference so React skips re-render).
 */
export function appendTextDelta(blocks: MessageBlock[], delta: string): MessageBlock[] {
  if (delta === '') return blocks;
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text') {
    return [...blocks.slice(0, -1), { type: 'text', text: last.text + delta }];
  }
  return [...blocks, { type: 'text', text: delta }];
}

/** Push a tool_use block referencing a ToolCall by id. */
export function appendToolUse(blocks: MessageBlock[], callId: string): MessageBlock[] {
  return [...blocks, { type: 'tool_use', callId }];
}

/**
 * Best-effort block reconstruction for legacy messages that were persisted
 * before the blocks format existed (or come over an API surface that only
 * carries content + toolCalls). Emits text first, then all tool_use blocks
 * in the order the calls appear — accurate ordering was lost on disk, so the
 * old "text before tools" rendering is the honest fallback.
 */
export function reconstructBlocksFromLegacy(
  content: string,
  toolCalls: Array<{ id: string }>
): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  if (content.trim() !== '') blocks.push({ type: 'text', text: content });
  for (const tc of toolCalls) blocks.push({ type: 'tool_use', callId: tc.id });
  return blocks;
}
