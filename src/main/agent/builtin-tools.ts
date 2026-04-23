import type { ToolHandler } from './tools';

export const getCurrentDateTime: ToolHandler = {
  parallelSafe: true,
  definition: {
    name: 'get_current_datetime',
    description: 'Get the current date and time in ISO 8601 format. Use when the user asks about the current time or date.',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone name (e.g., "Asia/Shanghai"). Default: system timezone.'
        }
      }
    }
  },
  async execute(args): Promise<string> {
    const tz = typeof args.timezone === 'string' ? args.timezone : undefined;
    const now = new Date();
    if (tz) {
      try {
        return now.toLocaleString('zh-CN', { timeZone: tz, hour12: false });
      } catch {
        return now.toISOString();
      }
    }
    return now.toISOString();
  }
};

export const BUILTIN_TOOLS: ToolHandler[] = [getCurrentDateTime];
