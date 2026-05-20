import { readFile } from 'fs/promises';
import { join } from 'path';

// Priority order: SEEKCODE.md > CLAUDE.md
const GUIDE_FILES = ['SEEKCODE.md', 'CLAUDE.md'];

export async function loadProjectGuide(cwd: string): Promise<string | null> {
  for (const filename of GUIDE_FILES) {
    try {
      const content = await readFile(join(cwd, filename), 'utf-8');
      return `\n\n---\n# Project Guide (${filename})\n\n${content.trim()}`;
    } catch {
      // not found, try next
    }
  }
  return null;
}
