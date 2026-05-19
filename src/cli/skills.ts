import { readdir, readFile, writeFile, access, mkdir, rm, unlink } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { homedir } from 'os';
import type { Dirent } from 'fs';
import AdmZip from 'adm-zip';

export interface Skill {
  name: string;
  description?: string;
  /** Optional system prompt override. When set, this replaces the default
   *  coding-assistant identity for the skill session, allowing the skill
   *  to define a completely different role (e.g. "You are a BaZi master"). */
  system?: string;
  content: string;
  source: 'project' | 'global';
  file: string; // relative file name
}

/** Parse YAML-style frontmatter from a markdown file.
 *  Supports both simple `key: value` pairs and multi-line literal blocks
 *  (`key: |` followed by indented content). */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!raw.startsWith('---')) return { meta, body: raw };

  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta, body: raw };

  const fm = raw.slice(3, end);
  const lines = fm.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colon = line.indexOf(':');
    if (colon === -1) { i++; continue; }

    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();

    if (rest === '|' || rest === '|-' || rest === '>') {
      // Multi-line literal / folded block scalar
      i++;
      const valueLines: string[] = [];
      let baseIndent: number | null = null;
      while (i < lines.length) {
        const nl = lines[i];
        if (nl.trim() === '') {
          valueLines.push('');
          i++;
          continue;
        }
        const indent = nl.length - nl.trimStart().length;
        if (baseIndent === null) baseIndent = indent;
        // Stop when we hit a non-empty line at lower indentation than the block base
        if (indent < (baseIndent ?? 0)) break;
        valueLines.push(nl.slice(baseIndent ?? indent));
        i++;
      }
      meta[key] = valueLines.join('\n').trim();
    } else {
      // Simple key: value
      meta[key] = rest.replace(/^["']|["']$/g, '');
      i++;
    }
  }

  return { meta, body: raw.slice(end + 4).trim() };
}

async function loadSkillsFromDir(dir: string, source: 'project' | 'global'): Promise<Skill[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    // Flat .md file directly in the skills dir
    if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const raw = await readFile(join(dir, entry.name), 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const skillName = meta['name'] ?? entry.name.replace(/\.md$/, '');
        skills.push({
          name: skillName,
          description: meta['description'],
          system: meta['system'],
          content: body,
          source,
          file: entry.name,
        });
      } catch {
        // skip unreadable files
      }
      continue;
    }

    // Subdirectory = a skill package (e.g. installed from zip)
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const subDir = join(dir, entry.name);
      try {
        const subEntries = await readdir(subDir, { withFileTypes: true });
        const mdFiles = subEntries.filter((e) => e.isFile() && e.name.endsWith('.md'));

        if (mdFiles.length === 0) continue;

        // Concatenate all .md contents; prefer frontmatter name, fallback to directory name
        const parts: string[] = [];
        let description: string | undefined;
        let system: string | undefined;
        let frontmatterName: string | undefined;

        for (const md of mdFiles) {
          const raw = await readFile(join(subDir, md.name), 'utf-8');
          const { meta, body } = parseFrontmatter(raw);
          if (!description && meta['description']) description = meta['description'];
          if (!system && meta['system']) system = meta['system'];
          if (!frontmatterName && meta['name']) frontmatterName = meta['name'];
          parts.push(body);
        }

        skills.push({
          name: frontmatterName ?? entry.name,
          description,
          system,
          content: parts.join('\n\n'),
          source,
          file: entry.name + '/',
        });
      } catch {
        // skip unreadable directories
      }
    }
  }

  return skills;
}

/** Global skills directory: ~/.seekcode/skills/ */
export function getGlobalSkillsDir(): string {
  return join(homedir(), '.seekcode', 'skills');
}

/** Project skills directory: .seekcode/skills/ */
export function getProjectSkillsDir(cwd: string): string {
  return resolve(cwd, '.seekcode', 'skills');
}

/** Load skills from project (.seekcode/skills/) and global (~/.seek/skills/) directories */
export async function loadSkills(cwd: string): Promise<Skill[]> {
  const projectDir = getProjectSkillsDir(cwd);
  const globalDir = getGlobalSkillsDir();

  const [projectSkills, globalSkills] = await Promise.all([
    loadSkillsFromDir(projectDir, 'project'),
    loadSkillsFromDir(globalDir, 'global'),
  ]);

  // Project skills take precedence over global ones with the same name
  const seen = new Set<string>();
  const result: Skill[] = [];
  for (const skill of [...projectSkills, ...globalSkills]) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      result.push(skill);
    }
  }

  return result;
}

/** Create a new skill file in the global skills directory */
export async function createSkill(name: string, description: string, content: string, system?: string): Promise<string> {
  const dir = getGlobalSkillsDir();
  await mkdir(dir, { recursive: true });

  const fileName = name.replace(/\s+/g, '-').toLowerCase() + '.md';
  const filePath = join(dir, fileName);

  const frontmatterLines = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
  ];
  if (system) {
    // Use YAML literal block scalar for multi-line system prompts
    frontmatterLines.push('system: |');
    for (const line of system.split('\n')) {
      frontmatterLines.push('  ' + line);
    }
  }
  frontmatterLines.push('---', '', content);

  await writeFile(filePath, frontmatterLines.join('\n'), 'utf-8');
  return fileName;
}

/** Install a skill from a .zip file into the global skills directory.
 *  Supports Claude Code skill zip format: one directory with .md files inside. */
export async function installSkillFromZip(zipPath: string): Promise<{ name: string; fileCount: number }> {
  const dir = getGlobalSkillsDir();
  await mkdir(dir, { recursive: true });

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    throw new Error(`Failed to read zip file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error('Zip file is empty');
  }

  // Collect all .md files and their paths
  const mdEntries = entries.filter((e) => e.entryName.endsWith('.md') && !e.isDirectory);
  if (mdEntries.length === 0) {
    throw new Error('No .md skill files found in zip');
  }

  // Determine the skill name from the common root directory, or use the first .md filename
  let skillName: string;

  // If all .md files are under a single root directory, use that directory name
  const rootDirs = new Set<string>();
  for (const e of mdEntries) {
    const parts = e.entryName.split('/');
    if (parts.length > 1) {
      rootDirs.add(parts[0]);
    }
  }

  if (rootDirs.size === 1) {
    skillName = [...rootDirs][0];
  } else {
    // No common root — use the zip filename (without extension)
    skillName = basename(zipPath).replace(/\.zip$/i, '');
  }

  // Extract all files into ~/.seekcode/skills/<skillName>/
  const skillDir = join(dir, skillName);
  await mkdir(skillDir, { recursive: true });

  // Extract all non-directory entries
  let fileCount = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;

    // Determine the relative path within the skill directory
    let relPath = entry.entryName;
    // Strip the common root prefix if there is one
    if (rootDirs.size === 1) {
      const prefix = skillName + '/';
      if (relPath.startsWith(prefix)) {
        relPath = relPath.slice(prefix.length);
      }
    }

    if (!relPath) continue;

    const destPath = join(skillDir, relPath);
    // Ensure parent directory exists
    const destDir = resolve(destPath, '..');
    if (destDir !== skillDir) {
      await mkdir(destDir, { recursive: true });
    }

    try {
      const content = entry.getData();
      await writeFile(destPath, content as Buffer);
      fileCount++;
    } catch {
      // skip files that can't be written
    }
  }

  return { name: skillName, fileCount };
}

/** Remove a skill from the global skills directory.
 *  Tries directory (zip-installed) first, then flat .md file. */
export async function removeSkill(name: string): Promise<string> {
  const dir = getGlobalSkillsDir();
  const skillDir = join(dir, name);
  const skillFile = join(dir, name + '.md');

  // Try removing a subdirectory first (zip-installed skill)
  try {
    await access(skillDir);
    await rm(skillDir, { recursive: true });
    return name;
  } catch {
    // Not a directory
  }

  // Try removing a flat .md file
  try {
    await access(skillFile);
    await unlink(skillFile);
    return name;
  } catch {
    // Not a file either
  }

  throw new Error(`Skill "${name}" not found in ${dir}`);
}
