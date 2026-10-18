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

/**
 * Version qui suit les liens symboliques.
 *
 * `resolveSafePath` ne regarde que le texte du chemin : un lien symbolique
 * créé dans le workspace (ex: `ln -s /etc/passwd leak.txt` via
 * run_command) le contourne, car `leak.txt` est bien "dans" le workspace
 * alors que sa cible n'y est pas. Ici on résout le chemin RÉEL et on
 * vérifie qu'il reste dans le workspace (réel).
 *
 * Gère aussi les chemins qui n'existent pas encore (écriture) en
 * vérifiant le plus proche ancêtre existant, et refuse les liens
 * "pendants" (cible inexistante) qui permettraient d'écrire hors zone.
 */
export async function resolveSafePathReal(relativePath: string): Promise<string> {
  const lexical = resolveSafePath(relativePath);
  const rootReal = await fs.realpath(WORKSPACE_ROOT).catch(() => WORKSPACE_ROOT);
  const inside = (p: string) => p === rootReal || p.startsWith(rootReal + path.sep);
  const refuse = () =>
    new Error(`Chemin refusé : "${relativePath}" pointe hors du workspace (lien symbolique ?).`);

  // 1. La cible elle-même est-elle un lien ?
  try {
    const st = await fs.lstat(lexical);
    if (st.isSymbolicLink()) {
      const real = await fs.realpath(lexical).catch(() => null);
      if (!real || !inside(real)) throw refuse();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  // 2. Le plus proche ancêtre existant doit rester dans le workspace réel
  let probe = lexical;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (!inside(real)) throw refuse();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(probe);
      if (parent === probe) throw refuse();
      probe = parent;
    }
  }
  return lexical;
}
