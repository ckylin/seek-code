import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ToolResult } from '../../types.js';
import { getToolByName } from './registry.js';
import { confirmEdit, applyEdit } from '../../utils/confirm.js';
import type { ConfirmChoice } from '../../utils/confirm.js';

// Module-level state for "yes for all" across tool calls
// yesAllSession — resets at the start of each new user turn
let yesAllSessionActive = false;

export function resetYesAll(): void {
  yesAllSessionActive = false;
}

async function confirmOrSkip(filePath: string, newContent: string): Promise<boolean> {
  if (yesAllSessionActive) return true;

  const choice: ConfirmChoice = await confirmEdit(filePath, newContent);
  if (choice === 'yes_all_session') {
    yesAllSessionActive = true;
    return true;
  }
  return choice === 'yes';
}

export async function executeTool(
  name: string,
  argsJson: string,
  cwd?: string,
): Promise<ToolResult> {
  const tool = getToolByName(name);
  if (!tool) {
    return { success: false, output: '', error: `Unknown tool: ${name}` };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return { success: false, output: '', error: `Invalid JSON arguments for tool ${name}: ${argsJson}` };
  }

  // Show diff and require confirmation before writing files
  if (name === 'edit_file') {
    const filePath = resolve(args.path as string);
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    const original = existsSync(filePath) ? await readFile(filePath, 'utf-8') : '';
    const preview = applyEdit(original, oldString, newString);
    if (preview === null) {
      return { success: false, output: '', error: `old_string not found in ${filePath}.` };
    }
    const accepted = await confirmOrSkip(filePath, preview);
    if (!accepted) {
      return { success: false, output: '', error: 'Edit rejected by user.', userRejected: true };
    }
  } else if (name === 'write_file') {
    const filePath = resolve(args.path as string);
    const content = args.content as string;
    const accepted = await confirmOrSkip(filePath, content);
    if (!accepted) {
      return { success: false, output: '', error: 'Write rejected by user.', userRejected: true };
    }
  }

  // Inject cwd into execute_shell if the model didn't provide one
  if (name === 'execute_shell' && cwd && !args.cwd) {
    args.cwd = cwd;
  }

  try {
    return await tool.execute(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: '', error: `Tool ${name} threw an error: ${message}` };
  }
}
