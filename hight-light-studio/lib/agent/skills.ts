import { resolveSafePathReal, ensureWorkspace } from './sandbox';
import * as fs from 'node:fs/promises';

export const SKILLS_DIR = '.hlstudio/skills';

export async function loadSkill(commandName: string): Promise<string | null> {
  try {
    await ensureWorkspace();
    const skillPath = await resolveSafePathReal(`${SKILLS_DIR}/${commandName}.md`);
    return await fs.readFile(skillPath, 'utf8');
  } catch (error) {
    return null;
  }
}

export async function listSkills(): Promise<string[]> {
  try {
    await ensureWorkspace();
    const skillsDirPath = await resolveSafePathReal(SKILLS_DIR);
    const files = await fs.readdir(skillsDirPath);
    return files
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.slice(0, -3));
  } catch (error) {
    return [];
  }
}

export function parseSkillCommand(task: string): { commandName: string; args: string } | null {
  const trimmed = task.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return {
      commandName: trimmed.slice(1),
      args: '',
    };
  }

  return {
    commandName: trimmed.slice(1, spaceIndex),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}
