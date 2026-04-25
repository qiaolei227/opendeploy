import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore } from '../../src/renderer/stores/chat-store';
import { useProjectsStore } from '../../src/renderer/stores/projects-store';
import type { Project } from '../../src/shared/erp-types';

const PROJECT_A: Project = {
  id: 'p_a',
  name: 'Project A',
  erpProvider: 'k3cloud',
  erpConfig: {} as Project['erpConfig'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};
const PROJECT_B: Project = { ...PROJECT_A, id: 'p_b', name: 'Project B' };

describe('chat-store loadConversation — project auto-switch', () => {
  let setActiveMock: ReturnType<typeof vi.fn>;
  let conversationsLoadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActiveMock = vi.fn().mockResolvedValue(undefined);
    conversationsLoadMock = vi.fn();
    (globalThis as unknown as { window: unknown }).window = {
      opendeploy: {
        conversationsLoad: conversationsLoadMock,
        projectsSetActive: setActiveMock
      }
    };
    useChatStore.setState({
      messages: [], isStreaming: false, error: null,
      currentRequestId: null, conversationId: null
    });
    useProjectsStore.setState({
      projects: [PROJECT_A, PROJECT_B],
      connectionState: { projectId: 'p_a', status: 'connected' },
      loading: false,
      error: null
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('switches active project when conversation.projectId differs', async () => {
    conversationsLoadMock.mockResolvedValue({
      id: 'c1', title: 't', projectId: 'p_b', messages: []
    });
    await useChatStore.getState().loadConversation('c1');
    expect(setActiveMock).toHaveBeenCalledWith('p_b');
  });

  it('no-op when conversation.projectId already matches active', async () => {
    conversationsLoadMock.mockResolvedValue({
      id: 'c1', title: 't', projectId: 'p_a', messages: []
    });
    await useChatStore.getState().loadConversation('c1');
    expect(setActiveMock).not.toHaveBeenCalled();
  });

  it('no-op when target project was deleted (not in projects[])', async () => {
    conversationsLoadMock.mockResolvedValue({
      id: 'c1', title: 't', projectId: 'p_deleted', messages: []
    });
    await useChatStore.getState().loadConversation('c1');
    expect(setActiveMock).not.toHaveBeenCalled();
  });

  it('no-op when conversation has no projectId (legacy)', async () => {
    conversationsLoadMock.mockResolvedValue({
      id: 'c1', title: 't', messages: []
    });
    await useChatStore.getState().loadConversation('c1');
    expect(setActiveMock).not.toHaveBeenCalled();
  });
});
