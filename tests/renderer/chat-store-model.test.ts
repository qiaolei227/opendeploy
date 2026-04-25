import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore } from '../../src/renderer/stores/chat-store';
import { useSettingsStore } from '../../src/renderer/stores/settings-store';
import { DEFAULT_SETTINGS } from '@shared/types';

describe('chat-store sendMessage — model 透传', () => {
  let llmSendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    llmSendMessage = vi.fn().mockResolvedValue({ requestId: 'req_1' });
    (globalThis as unknown as { window: unknown }).window = {
      opendeploy: {
        llmSendMessage,
        llmOnStream: () => () => {} // unsubscribe noop
      }
    };
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      error: null,
      currentRequestId: null,
      conversationId: null
    });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: false });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('passes modelByProvider[deepseek] as IPC payload.model', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, modelByProvider: { deepseek: 'deepseek-v4-pro' } },
      loaded: true
    });
    await useChatStore.getState().sendMessage('hi', 'deepseek', 'sk-test');
    expect(llmSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'deepseek', model: 'deepseek-v4-pro' })
    );
  });

  it('falls back to recommended model when modelByProvider has no entry', async () => {
    await useChatStore.getState().sendMessage('hi', 'claude', 'sk-test');
    expect(llmSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
    );
  });

  it('Ollama uses ollamaModelInput when set', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, ollamaModelInput: 'qwen2.5:14b' },
      loaded: true
    });
    await useChatStore.getState().sendMessage('hi', 'ollama', undefined);
    expect(llmSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'ollama', model: 'qwen2.5:14b' })
    );
  });

  it('Ollama falls back to modelInputDefault when not set', async () => {
    await useChatStore.getState().sendMessage('hi', 'ollama', undefined);
    expect(llmSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'qwen2.5-coder' })
    );
  });
});
