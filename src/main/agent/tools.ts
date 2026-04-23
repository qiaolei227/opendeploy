import type { ToolDefinition, ToolResult } from '@shared/llm-types';

export interface ToolHandler {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
  /**
   * Read-only / side-effect-free tools set this so the agent loop can batch
   * multiple calls in a single turn with Promise.all. Writers (DB mutations,
   * file writes) must leave it unset — a parallel batch is only parallelized
   * when every call in it is parallelSafe, otherwise the loop falls back to
   * serial execution.
   */
  parallelSafe?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    if (this.tools.has(handler.definition.name)) {
      throw new Error(`Tool already registered: ${handler.definition.name}`);
    }
    this.tools.set(handler.definition.name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(h => h.definition);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const handler = this.tools.get(name);
    if (!handler) {
      return { toolCallId: '', content: `Unknown tool: ${name}`, isError: true };
    }
    try {
      const output = await handler.execute(args);
      return { toolCallId: '', content: output, isError: false };
    } catch (err) {
      return {
        toolCallId: '',
        content: err instanceof Error ? err.message : String(err),
        isError: true
      };
    }
  }
}
