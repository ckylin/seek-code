import { readdir, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';
import type { Tool, ToolResult } from '../../types.js';

const MAX_ENTRIES = 200;

export const listDirectoryTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories in a path. Returns a tree-like structure.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to list (defaults to current directory)',
          },
          depth: {
            type: 'number',
            description: 'Maximum depth to recurse (default: 2)',
          },
        },
        required: [],
      },
    },
  },

  async execute(args): Promise<ToolResult> {
    const dirPath = resolve((args.path as string | undefined) ?? '.');
    const maxDepth = (args.depth as number | undefined) ?? 2;

    try {
      const lines: string[] = [];
      await walk(dirPath, dirPath, 0, maxDepth, lines);

      if (lines.length === 0) {
        return { success: true, output: '(empty directory)' };
      }

      const truncated = lines.length > MAX_ENTRIES;
      const output = lines.slice(0, MAX_ENTRIES).join('\n') +
        (truncated ? `\n… (${lines.length - MAX_ENTRIES} more entries not shown)` : '');

      return { success: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to list ${dirPath}: ${message}` };
    }
  },
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache']);

async function walk(
  root: string,
  dir: string,
  depth: number,
  maxDepth: number,
  lines: string[],
): Promise<void> {
  if (depth > maxDepth) return;

  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (entry.name.startsWith('.') && depth > 0) continue;
    const indent = '  '.repeat(depth);
    const rel = relative(root, join(dir, entry.name));

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        lines.push(`${indent}${entry.name}/ (skipped)`);
        continue;
      }
      lines.push(`${indent}${entry.name}/`);
      await walk(root, join(dir, entry.name), depth + 1, maxDepth, lines);
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }
}
