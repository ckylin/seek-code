import type { Tool, ToolDefinition } from '../../types.js';
import { readFileTool } from './read_file.js';
import { writeFileTool } from './write_file.js';
import { editFileTool } from './edit_file.js';
import { executeShellTool } from './execute_shell.js';
import { listDirectoryTool } from './list_directory.js';
import { searchFilesTool } from './search_files.js';

const ALL_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  executeShellTool,
  listDirectoryTool,
  searchFilesTool,
];

export function getAllTools(): Tool[] {
  return ALL_TOOLS;
}

export function getToolDefinitions(): ToolDefinition[] {
  return ALL_TOOLS.map((t) => t.definition);
}

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.definition.function.name === name);
}
