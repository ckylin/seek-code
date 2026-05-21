import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ToolResult } from '../../types.js';
import { getToolByName } from './registry.js';
import { confirmEdit, applyEdit } from '../../utils/confirm.js';

// Module-level state for "yes for all" across tool calls
let yesAllSessionActive = false;

export function resetYesAll(): void {
  yesAllSessionActive = false;
}

/**
 * Show confirmation dialog for write/edit operations.
 * Uses pre-read content when available to avoid redundant disk I/O.
 *
 * Returns the original file content so the tool can skip its own read.
 */
async function confirmOrSkip(
  filePath: string,
  newContent: string,
  preReadOriginal?: string,
): Promise<{ accepted: boolean; originalContent: string }> {
  // Fast path: "yes for all" active — skip dialog, but still return
  // original content for the tool's diff display.
  if (yesAllSessionActive) {
    const absPath = resolve(filePath);
    const original = preReadOriginal !== undefined
      ? preReadOriginal
      : (existsSync(absPath) ? await readFile(absPath, 'utf-8') : '');
    return { accepted: true, originalContent: original };
  }

  const { choice, originalContent } = await confirmEdit(filePath, newContent, preReadOriginal);
  if (choice === 'yes_all_session') {
    yesAllSessionActive = true;
  }
  return { accepted: choice === 'yes' || choice === 'yes_all_session', originalContent };
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

  // Validate required parameters
  const requiredParams: Record<string, string[]> = {
    read_file: ['path'],
    write_file: ['path', 'content'],
    edit_file: ['path', 'old_string', 'new_string'],
    execute_shell: ['command'],
    search_files: ['pattern'],
  };
  const required = requiredParams[name];
  if (required) {
    for (const p of required) {
      if (args[p] === undefined || args[p] === null) {
        return { success: false, output: '', error: `Missing required parameter "${p}" for tool ${name}` };
      }
    }
  }

  // ── Pre-read + confirm for destructive operations ──────────────────────
  // We read the file once for diff preview, then pass the content to both
  // the confirm dialog AND the tool. This eliminates 1-2 redundant disk reads
  // per destructive operation (previously: executor read + confirm re-read +
  // tool re-read = up to 3 reads per edit).
  if (name === 'edit_file') {
    const filePath = resolve(args.path as string);
    const oldString = args.old_string as string;
    const newString = args.new_string as string;

    // Single read for both preview and the eventual edit
    const original = existsSync(filePath) ? await readFile(filePath, 'utf-8') : '';
    const preview = applyEdit(original, oldString, newString);
    if (preview === null) {
      return { success: false, output: '', error: `old_string not found in ${filePath}.` };
    }

    const { accepted } = await confirmOrSkip(filePath, preview, original);
    if (!accepted) {
      return { success: false, output: '', error: 'Edit rejected by user.', userRejected: true };
    }
    args._originalContent = original;
  } else if (name === 'write_file') {
    const filePath = resolve(args.path as string);
    const content = args.content as string;

    const { accepted, originalContent } = await confirmOrSkip(filePath, content);
    if (!accepted) {
      return { success: false, output: '', error: 'Write rejected by user.', userRejected: true };
    }
    args._originalContent = originalContent;
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
