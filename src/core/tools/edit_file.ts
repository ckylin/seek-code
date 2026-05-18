import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { Tool, ToolResult } from '../../types.js';
import { printDiff } from '../../utils/display.js';

export const editFileTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact string in a file with new content. The old_string must match exactly (including whitespace). Fails clearly if old_string is not found.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact string to find and replace',
          },
          new_string: {
            type: 'string',
            description: 'The string to replace it with',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },

  async execute(args): Promise<ToolResult> {
    const filePath = resolve(args.path as string);
    const oldString = args.old_string as string;
    const newString = args.new_string as string;

    try {
      const content = await readFile(filePath, 'utf-8');

      if (!content.includes(oldString)) {
        return {
          success: false,
          output: '',
          error: `old_string not found in ${filePath}. The string must match exactly including whitespace and indentation.`,
        };
      }

      const updated = content.replace(oldString, newString);
      await writeFile(filePath, updated, 'utf-8');
      printDiff(filePath, content, updated);
      return { success: true, output: `Edited ${filePath}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to edit ${filePath}: ${message}` };
    }
  },
};
