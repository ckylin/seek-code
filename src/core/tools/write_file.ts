import { writeFile as fsWriteFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import type { Tool, ToolResult } from '../../types.js';
import { printDiff } from '../../utils/display.js';

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
    // Use pre-read content from executor if available (avoids double read)
    const oldContent = (args._originalContent as string | undefined) ?? '';
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await fsWriteFile(filePath, content, 'utf-8');
      printDiff(filePath, oldContent, content);
      return { success: true, output: `Wrote ${content.length} chars to ${filePath}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to write ${filePath}: ${message}` };
    }
  },
};
