import { readFile as fsReadFile } from 'fs/promises';
import { resolve } from 'path';
import type { Tool, ToolResult } from '../../types.js';

const MAX_CHARS = 8000;

export const readFileTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content as a string. Large files are truncated.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read (absolute or relative to cwd)',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args): Promise<ToolResult> {
    const filePath = resolve(args.path as string);
    try {
      const content = await fsReadFile(filePath, 'utf-8');
      if (content.length > MAX_CHARS) {
        return {
          success: true,
          output: content.slice(0, MAX_CHARS) + `\n\n[File truncated — ${content.length} total chars, showing first ${MAX_CHARS}]`,
        };
      }
      return { success: true, output: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to read ${filePath}: ${message}` };
    }
  },
};
