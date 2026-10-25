import path from "node:path";
import fs from "node:fs/promises";
import AdmZip from "adm-zip";
import {
  WORKSPACE_ROOT,
  ensureWorkspace,
  resolveSafePath,
  resolveSafePathReal,
} from "@/lib/agent/sandbox";

/** Au-delà, l'aperçu de fichier n'a plus d'intérêt et sature le navigateur. */
const MAX_PREVIEW_BYTES = 512 * 1024;

/** Dossiers jamais inclus dans une archive : volumineux et reconstructibles. */
const ARCHIVE_EXCLUDES = new Set(["node_modules", ".next", ".git", "dist", "build"]);

export interface DirEntry {
  name: string;
  isDir: boolean;
  size?: number;
}

export type WorkspaceNode =
  | { type: "dir"; path: string; entries: DirEntry[] }
  | { type: "file"; path: string; content: string; truncated: boolean }
  | { type: "binary"; path: string; size: number };

/**
 * Lit un chemin du workspace : contenu du dossier, ou contenu du fichier.
 * Le chemin passe par `resolveSafePathReal`, qui refuse autant les `..` que
 * les liens symboliques pointant hors du workspace.
 */
export async function readWorkspaceNode(relativePath: string): Promise<WorkspaceNode> {
  await ensureWorkspace();
  const absolute = await resolveSafePathReal(relativePath || ".");
  const stat = await fs.stat(absolute);

  if (stat.isDirectory()) {
    const dirents = await fs.readdir(absolute, { withFileTypes: true });
    const entries: DirEntry[] = [];

    for (const dirent of dirents) {
      // Un lien symbolique est présenté comme un fichier : son ouverture
      // sera de toute façon refusée s'il sort du workspace.
      const isDir = dirent.isDirectory();
      let size: number | undefined;
      if (!isDir) {
        size = await fs
          .stat(path.join(absolute, dirent.name))
          .then((s) => s.size)
          .catch(() => undefined);
      }
      entries.push({ name: dirent.name, isDir, size });
    }

    entries.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    );
    return { type: "dir", path: relativePath, entries };
  }

  const buffer = await fs.readFile(absolute);
  const slice = buffer.subarray(0, MAX_PREVIEW_BYTES);

  // Un octet nul dans le début du fichier signe un binaire : l'envoyer en
  // texte produirait des caractères de remplacement illisibles.
  if (slice.includes(0)) {
    return { type: "binary", path: relativePath, size: stat.size };
  }

  return {
    type: "file",
    path: relativePath,
    content: slice.toString("utf-8"),
    truncated: buffer.length > MAX_PREVIEW_BYTES,
  };
}

/** Nombre de fichiers du workspace, pour prévenir avant de l'écraser. */
export async function countWorkspaceFiles(limit = 10_000): Promise<number> {
  await ensureWorkspace();
  let count = 0;

  async function walk(dir: string): Promise<void> {
    if (count >= limit) return;
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (count >= limit) return;
      if (dirent.isDirectory()) {
        if (ARCHIVE_EXCLUDES.has(dirent.name)) continue;
        await walk(path.join(dir, dirent.name));
      } else {
        count += 1;
      }
    }
  }

  await walk(WORKSPACE_ROOT);
  return count;
}

/** Vide le workspace sans supprimer le dossier lui-même. */
export async function clearWorkspace(): Promise<void> {
  await ensureWorkspace();
  for (const entry of await fs.readdir(WORKSPACE_ROOT)) {
    await fs.rm(path.join(WORKSPACE_ROOT, entry), { recursive: true, force: true });
  }
}

/** Archive le workspace en mémoire, en excluant les dossiers reconstructibles. */
export async function zipWorkspace(): Promise<Buffer> {
  await ensureWorkspace();
  const zip = new AdmZip();

  async function walk(dir: string, prefix: string): Promise<void> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const absolute = path.join(dir, dirent.name);
      const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name;

      if (dirent.isDirectory()) {
        if (ARCHIVE_EXCLUDES.has(dirent.name)) continue;
        await walk(absolute, relative);
      } else if (dirent.isFile()) {
        // isFile() exclut les liens symboliques : les suivre ferait entrer
        // dans l'archive des fichiers situés hors du workspace.
        zip.addFile(relative, await fs.readFile(absolute));
      }
    }
  }

  await walk(WORKSPACE_ROOT, "");
  return zip.toBuffer();
}

export interface ExtractResult {
  extracted: string[];
  skipped: string[];
}

/**
 * Extrait une archive dans le workspace.
 *
 * Chaque entrée est revalidée individuellement : une archive peut contenir
 * des chemins `../../etc/passwd` (« zip slip ») que la bibliothèque
 * d'extraction écrirait sans broncher.
 */
export async function extractZipBuffer(
  buffer: Buffer,
  subdir = ""
): Promise<ExtractResult> {
  await ensureWorkspace();
  const zip = new AdmZip(buffer);
  const extracted: string[] = [];
  const skipped: string[] = [];

  for (const entry of zip.getEntries()) {
    const entryPath = entry.entryName.replace(/\\/g, "/");
    if (entry.isDirectory) continue;
    if (entryPath.includes("..") || path.isAbsolute(entryPath)) {
      skipped.push(entryPath);
      continue;
    }

    const target = subdir ? `${subdir}/${entryPath}` : entryPath;
    let absolute: string;
    try {
      absolute = resolveSafePath(target);
    } catch {
      skipped.push(entryPath);
      continue;
    }

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, entry.getData());
    extracted.push(target);
  }

  return { extracted, skipped };
}
