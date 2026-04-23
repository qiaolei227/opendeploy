import type { Message } from '@shared/llm-types';

const PRUNED_PLACEHOLDER =
  '[tool result pruned to save context — re-run the tool if you actually need this result]';

/**
 * Keep the last `keepLastN` tool-result messages intact; replace the content
 * of earlier `tool` messages with a short placeholder. Preserves every field
 * that the API pairs on (`toolCallId`, `role`, `id`, `createdAt`) — only
 * `content` is swapped. This keeps the assistant's `tool_call`s validly
 * paired with a `tool` response, so the provider API never rejects the
 * message list.
 *
 * The idea: agent already digested old tool results into its subsequent
 * assistant-text reasoning ("I saw that the field is FCreditLimit of type
 * Decimal..."). The raw JSON dump just sits there costing tokens on every
 * turn. If the agent truly needs to re-read it, the placeholder hints at
 * re-running the tool — cheaper on any modestly-long conversation.
 *
 * - `keepLastN=0` prunes every tool message.
 * - If fewer tool messages exist than `keepLastN`, this is a no-op.
 * - System / user / assistant messages are always untouched.
 */
export function pruneOldToolResults(messages: Message[], keepLastN: number): Message[] {
  if (keepLastN < 0) throw new Error('keepLastN must be >= 0');
  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIndexes.push(i);
  }
  if (toolIndexes.length <= keepLastN) return messages;
  // Math.max form avoids slice(-0) === slice(0) footgun that keeps everything
  // when keepLastN === 0.
  const keepFrom = Math.max(0, toolIndexes.length - keepLastN);
  const keep = new Set(toolIndexes.slice(keepFrom));
  return messages.map((m, i) => {
    if (m.role === 'tool' && !keep.has(i)) {
      return { ...m, content: PRUNED_PLACEHOLDER };
    }
    return m;
  });
}
