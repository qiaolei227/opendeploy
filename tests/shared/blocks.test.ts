import { describe, it, expect } from 'vitest';
import {
  appendTextDelta,
  appendToolUse,
  reconstructBlocksFromLegacy,
  type MessageBlock
} from '../../src/shared/blocks';

describe('shared/blocks', () => {
  describe('appendTextDelta', () => {
    it('creates a text block when none exist', () => {
      const b = appendTextDelta([], 'hello');
      expect(b).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('merges into last text block', () => {
      const b = appendTextDelta([{ type: 'text', text: 'hel' }], 'lo');
      expect(b).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('creates a new text block after a tool_use block', () => {
      const existing: MessageBlock[] = [
        { type: 'text', text: 'before' },
        { type: 'tool_use', callId: 'tc1' }
      ];
      const b = appendTextDelta(existing, 'after');
      expect(b).toEqual([
        { type: 'text', text: 'before' },
        { type: 'tool_use', callId: 'tc1' },
        { type: 'text', text: 'after' }
      ]);
    });

    it('returns the original array reference on empty delta', () => {
      const original: MessageBlock[] = [{ type: 'text', text: 'x' }];
      const b = appendTextDelta(original, '');
      expect(b).toBe(original);
    });
  });

  describe('appendToolUse', () => {
    it('pushes a tool_use block at the end', () => {
      const b = appendToolUse([{ type: 'text', text: 'hi' }], 'tc1');
      expect(b).toEqual([
        { type: 'text', text: 'hi' },
        { type: 'tool_use', callId: 'tc1' }
      ]);
    });

    it('works on empty list', () => {
      const b = appendToolUse([], 'tc1');
      expect(b).toEqual([{ type: 'tool_use', callId: 'tc1' }]);
    });
  });

  describe('reconstructBlocksFromLegacy', () => {
    it('renders text before tools (best effort for historic)', () => {
      const b = reconstructBlocksFromLegacy('hello', [{ id: 'tc1' }, { id: 'tc2' }]);
      expect(b).toEqual([
        { type: 'text', text: 'hello' },
        { type: 'tool_use', callId: 'tc1' },
        { type: 'tool_use', callId: 'tc2' }
      ]);
    });

    it('skips text block when content is whitespace', () => {
      const b = reconstructBlocksFromLegacy('   \n\n  ', [{ id: 'tc1' }]);
      expect(b).toEqual([{ type: 'tool_use', callId: 'tc1' }]);
    });

    it('returns empty list for empty input', () => {
      const b = reconstructBlocksFromLegacy('', []);
      expect(b).toEqual([]);
    });

    it('returns only text block when no tool calls', () => {
      const b = reconstructBlocksFromLegacy('hi', []);
      expect(b).toEqual([{ type: 'text', text: 'hi' }]);
    });
  });

  describe('streaming scenario (integration of appendTextDelta + appendToolUse)', () => {
    it('preserves stream order: text, tool, text, tool, text', () => {
      let b: MessageBlock[] = [];
      b = appendTextDelta(b, 'I will ');
      b = appendTextDelta(b, 'check one thing.');
      b = appendToolUse(b, 'tc1');
      b = appendTextDelta(b, 'Got it. Now the next step:');
      b = appendToolUse(b, 'tc2');
      b = appendTextDelta(b, 'Done.');

      expect(b).toEqual([
        { type: 'text', text: 'I will check one thing.' },
        { type: 'tool_use', callId: 'tc1' },
        { type: 'text', text: 'Got it. Now the next step:' },
        { type: 'tool_use', callId: 'tc2' },
        { type: 'text', text: 'Done.' }
      ]);
    });
  });
});
