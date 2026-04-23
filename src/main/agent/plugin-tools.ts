import { getConnectionState } from '../erp/active';
import {
  listPlugins,
  readPlugin,
  writePlugin
} from '../plugins/store';
import { WRITE_PLUGIN_TOOL_NAME } from '@shared/plugin-types';
import type { ToolHandler } from './tools';

/**
 * Agent tool trio for plugin-file lifecycle. Only registered (and thus
 * exposed to the LLM) when a K/3 Cloud project is active — a write_plugin
 * with no target project has nowhere sensible to go.
 *
 * Tools read the active project id from erp/active, not from any arg, so the
 * agent can't accidentally target a different project by mis-filling a param.
 */
export function buildPluginTools(): ToolHandler[] {
  if (!getConnectionState().projectId) return [];
  return [writePluginTool(), listPluginsTool(), readPluginTool()];
}

function requireActiveProject(): string {
  const id = getConnectionState().projectId;
  if (!id) throw new Error('no active project — set one on the Projects page first');
  return id;
}

function writePluginTool(): ToolHandler {
  return {
    definition: {
      name: WRITE_PLUGIN_TOOL_NAME,
      description:
        '把一段 Python 代码保存为当前项目的表单插件文件。仅在需求澄清 + 元数据查询完成后调用。filename 必须以 .py 结尾、不含路径分隔符、不含中文或空格，例如 "credit_limit_guard.py"。写完后你应告知用户文件路径，并提示他们按 skill 指导注册到金蝶客户端。',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: '插件文件名，ASCII 字母/数字/下划线/短横，以 .py 结尾。'
          },
          content: {
            type: 'string',
            description: '完整的 Python 源代码（IronPython 2.7，K/3 Cloud V9 表单插件语法）。'
          }
        },
        required: ['filename', 'content']
      }
    },
    async execute(args) {
      const projectId = requireActiveProject();
      const filename = args.filename;
      const content = args.content;
      if (typeof filename !== 'string') throw new Error('filename must be a string');
      if (typeof content !== 'string') throw new Error('content must be a string');
      const r = await writePlugin(projectId, filename, content);
      return JSON.stringify(
        {
          created: r.created,
          path: r.file.path,
          filename: r.file.name,
          lines: r.lines,
          size: r.file.size,
          projectId: r.projectId
        },
        null,
        2
      );
    }
  };
}

function listPluginsTool(): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'list_plugins',
      description:
        '列出当前项目 plugins 目录下已有的 .py 文件。用于判断是否有可复用 / 增量修改的插件。',
      parameters: { type: 'object', properties: {} }
    },
    async execute() {
      const projectId = requireActiveProject();
      const files = await listPlugins(projectId);
      return JSON.stringify({ projectId, count: files.length, files }, null, 2);
    }
  };
}

function readPluginTool(): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'read_plugin',
      description:
        '读取已有插件的完整 Python 源码。用于在现有插件基础上做增量修改。filename 来自 list_plugins 的结果。',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: '插件文件名（来自 list_plugins）。'
          }
        },
        required: ['filename']
      }
    },
    async execute(args) {
      const projectId = requireActiveProject();
      const filename = args.filename;
      if (typeof filename !== 'string' || !filename.trim()) {
        throw new Error('filename must be a non-empty string');
      }
      const content = await readPlugin(projectId, filename);
      return JSON.stringify({ projectId, filename, content }, null, 2);
    }
  };
}
