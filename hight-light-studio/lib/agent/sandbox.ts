import path from "node:path";
import fs from "node:fs/promises";

// Racine du "bac à sable" de l'agent — toutes les opérations fichiers
// (read_file, write_file, list_files) sont restreintes à ce dossier.
// Configurable via AGENT_WORKSPACE_DIR, sinon "./workspace" par défaut.
export const WORKSPACE_ROOT = path.resolve(
  process.env.AGENT_WORKSPACE_DIR ?? path.join(process.cwd(), "workspace")
);

export async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
}

/**
 * Résout un chemin relatif fourni par l'agent et vérifie qu'il reste
 * strictement à l'intérieur de WORKSPACE_ROOT — protection contre le
 * path traversal (ex: l'agent essayant "../../etc/passwd" ou un chemin
 * absolu en dehors du workspace).
 */
export function resolveSafePath(relativePath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath || ".");
  const normalizedRoot = WORKSPACE_ROOT.endsWith(path.sep)
    ? WORKSPACE_ROOT
    : WORKSPACE_ROOT + path.sep;

  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(normalizedRoot)) {
    throw new Error(
      `Chemin refusé : "${relativePath}" sort du workspace autorisé (${WORKSPACE_ROOT}).`
    );
  }
  return resolved;
}
