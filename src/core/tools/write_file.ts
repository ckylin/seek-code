import { writeFile as fsWriteFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import type { Tool, ToolResult } from '../../types.js';

export const writeFileTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating parent directories if needed. Overwrites existing content.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },

  async execute(args): Promise<ToolResult> {
    const filePath = resolve(args.path as string);
    const content = args.content as string;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await fsWriteFile(filePath, content, 'utf-8');
      // Diff already shown in confirmation dialog; here we just confirm success
      return { success: true, output: `Wrote ${content.length} chars to ${filePath}` , confirmDurationMs: (args._confirmDurationMs as number) ?? 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to write ${filePath}: ${message}` };
    }
  },
};
