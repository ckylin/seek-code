import { createReadStream, statSync } from 'fs';
import { resolve } from 'path';
import type { Tool, ToolResult } from '../../types.js';

const MAX_BYTES = 30_000;

function readFirstBytes(filePath: string, maxBytes: number): Promise<{ buf: Buffer; totalSize: number }> {
  return new Promise((res, rej) => {
    let totalSize = 0;
    try { totalSize = statSync(filePath).size; } catch { /* ignore */ }

    const chunks: Buffer[] = [];
    let collected = 0;
    const stream = createReadStream(filePath, { highWaterMark: 65536 });

    stream.on('data', (chunk: Buffer | string) => {
      const data: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      const remaining = maxBytes - collected;
      if (remaining <= 0) { stream.destroy(); return; }
      const slice = data.length <= remaining ? data : data.subarray(0, remaining);
      chunks.push(slice);
      collected += slice.length;
      if (collected >= maxBytes) stream.destroy();
    });

    stream.on('close', () => res({ buf: Buffer.concat(chunks), totalSize }));
    stream.on('error', rej);
  });
}

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
      const { buf, totalSize } = await readFirstBytes(filePath, MAX_BYTES);
      const content = buf.toString('utf-8');
      if (totalSize > MAX_BYTES) {
        return {
          success: true,
          output: content + `\n\n[File truncated — ${totalSize} total bytes, showing first ${MAX_BYTES}]`,
        };
      }
      return { success: true, output: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to read ${filePath}: ${message}` };
    }
  },
};
