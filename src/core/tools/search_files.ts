import { readdir, readFile } from 'fs/promises';
import { join, resolve, relative } from 'path';
import type { Tool, ToolResult } from '../../types.js';

const MAX_RESULTS = 50;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache']);

export const searchFilesTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a pattern in files. Returns matching file paths and line snippets.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The text pattern to search for',
          },
          path: {
            type: 'string',
            description: 'Directory to search in (defaults to current directory)',
          },
          file_pattern: {
            type: 'string',
            description: 'Glob-like file extension filter, e.g. ".ts" or ".py" (optional)',
          },
        },
        required: ['pattern'],
      },
    },
  },

  async execute(args): Promise<ToolResult> {
    const pattern = args.pattern as string;
    const searchPath = resolve((args.path as string | undefined) ?? '.');
    const filePattern = args.file_pattern as string | undefined;

    const results: string[] = [];

    try {
      await searchDir(searchPath, searchPath, pattern, filePattern, results);

      if (results.length === 0) {
        return { success: true, output: `No matches found for "${pattern}"` };
      }

      const truncated = results.length > MAX_RESULTS;
      const output = results.slice(0, MAX_RESULTS).join('\n') +
        (truncated ? `\n… (showing first ${MAX_RESULTS} of ${results.length} matches)` : '');

      return { success: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Search failed: ${message}` };
    }
  },
};

async function searchDir(
  root: string,
  dir: string,
  pattern: string,
  filePattern: string | undefined,
  results: string[],
): Promise<void> {
  if (results.length >= MAX_RESULTS) return;

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return;
    if (entry.name.startsWith('.')) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await searchDir(root, fullPath, pattern, filePattern, results);
    } else {
      if (filePattern && !entry.name.endsWith(filePattern)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const rel = relative(root, fullPath);

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(pattern)) {
            results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
            if (results.length >= MAX_RESULTS) return;
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}
