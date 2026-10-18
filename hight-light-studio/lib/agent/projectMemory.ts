import { resolveSafePathReal, ensureWorkspace } from './sandbox';
import * as fs from 'node:fs/promises';

export async function loadProjectMemory(): Promise<string | null> {
  try {
    await ensureWorkspace();
    const memoryPath = await resolveSafePathReal('HL.md');
    return await fs.readFile(memoryPath, 'utf8');
  } catch (error) {
    return null;
  }
}
