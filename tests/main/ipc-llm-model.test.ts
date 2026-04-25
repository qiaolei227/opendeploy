import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture handlers registered via ipcMain.handle so we can invoke them directly
type IpcHandler = (event: unknown, req: unknown) => Promise<unknown>;
const handlerMap = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      handlerMap.set(channel, handler);
    }
  }
}));

const runAgentLoopMock = vi.fn().mockResolvedValue([]);
vi.mock('../../src/main/agent/loop', () => ({
  runAgentLoop: (...args: unknown[]) => runAgentLoopMock(...args)
}));

vi.mock('../../src/main/llm/factory', () => ({
  createLlmClient: vi.fn(() => ({ stream: vi.fn() }))
}));
vi.mock('../../src/main/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock('../../src/main/agent/tools', () => ({
  ToolRegistry: class {
    register(): void {}
    definitions(): unknown[] { return []; }
  }
}));
vi.mock('../../src/main/agent/builtin-tools', () => ({ BUILTIN_TOOLS: [] }));
vi.mock('../../src/main/agent/skills-integration', () => ({
  buildSkillsContext: vi.fn().mockResolvedValue({
    systemPromptFragment: '',
    loadSkillTool: { name: 'load_skill' },
    loadSkillFileTool: { name: 'load_skill_file' }
  })
}));
vi.mock('../../src/main/agent/k3cloud-tools', () => ({
  activeProjectTag: () => '',
  buildK3CloudTools: () => []
}));
vi.mock('../../src/main/agent/erp-rules', () => ({
  erpRulesFragment: () => ''
}));
vi.mock('../../src/main/erp/active', () => ({
  getConnectionState: () => ({ projectId: null, erpProvider: null })
}));
vi.mock('../../src/main/projects/store', () => ({ getProject: vi.fn() }));
vi.mock('../../src/main/agent/plugin-tools', () => ({ buildPluginTools: () => [] }));
vi.mock('../../src/main/agent/plan-tools', () => ({ buildPlanTools: () => [] }));
vi.mock('../../src/main/agent/bos-write-tools', () => ({ buildBosWriteTools: () => [] }));
vi.mock('../../src/main/conversations/store', () => ({
  loadConversation: vi.fn(),
  saveConversation: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn(),
  deleteConversation: vi.fn()
}));

// Vite ?raw imports become string default exports at runtime
vi.mock('../../src/main/agent/prompts/base-system.md?raw', () => ({ default: 'base' }));
vi.mock('../../src/main/agent/prompts/erp-rules/k3cloud.md?raw', () => ({ default: 'k3' }));
vi.mock('../../src/main/agent/prompts/active-project-tag.md?raw', () => ({ default: 'tag' }));
vi.mock('../../src/main/agent/prompts/skills-catalog-intro.md?raw', () => ({ default: 'intro' }));

import { registerLlmIpc } from '../../src/main/ipc-llm';

describe('ipc-llm — model 透传', () => {
  beforeEach(() => {
    handlerMap.clear();
    runAgentLoopMock.mockReset();
    runAgentLoopMock.mockResolvedValue([]);
    registerLlmIpc(() => null);
  });

  it('forwards req.model to runAgentLoop', async () => {
    const handler = handlerMap.get('llm:send')!;
    expect(handler).toBeDefined();
    await handler(null, {
      providerId: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-v4-pro',
      userMessage: 'hi'
    });
    // Handler launches the agent loop in a void IIFE; let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 30));
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'deepseek',
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro'
      })
    );
  });

  it('passes model: undefined when payload omits it', async () => {
    const handler = handlerMap.get('llm:send')!;
    await handler(null, {
      providerId: 'claude',
      apiKey: 'sk-ant',
      userMessage: 'hi'
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'claude', model: undefined })
    );
  });
});
