import { spawn } from 'child_process';
import type { Tool, ToolResult } from '../../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export const executeShellTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'execute_shell',
      description: 'Execute a shell command and return its output. The working directory is already set to the project root — do NOT prepend "cd <path> &&" to commands. Use for running tests, builds, installing packages, git commands, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (optional, defaults to current directory)',
          },
          timeout_ms: {
            type: 'number',
            description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
          },
        },
        required: ['command'],
      },
    },
  },

  async execute(args): Promise<ToolResult> {
    const command = args.command as string;
    const cwd = (args.cwd as string | undefined) ?? process.cwd();
    const timeoutMs = (args.timeout_ms as number | undefined) ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
      const chunks: string[] = [];
      let timedOut = false;

      const child = spawn(command, {
        shell: true,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (data: Buffer) => chunks.push(data.toString()));
      child.stderr.on('data', (data: Buffer) => chunks.push(data.toString()));

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        const output = chunks.join('');
        if (timedOut) {
          resolve({ success: false, output, error: `Command timed out after ${timeoutMs}ms` });
        } else if (code !== 0) {
          resolve({ success: false, output, error: `Command exited with code ${code}` });
        } else {
          resolve({ success: true, output: output || '(no output)' });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, output: '', error: err.message });
      });
    });
  },
};
