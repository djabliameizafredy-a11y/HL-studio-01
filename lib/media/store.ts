import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mediaDirPath } from "@/lib/paths";

// Extensions servies par /api/media. Une liste fermée plutôt que de dériver
// l'extension du type MIME renvoyé par le fournisseur : sinon un fournisseur
// malveillant (ou mal configuré) pourrait faire écrire un .html ou un .svg,
// tous deux capables d'exécuter du script une fois servis par notre origine.
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mime, ext]) => [ext, mime])
);

export interface SavedMedia {
  /** Chemin servi par l'application, jamais un chemin disque. */
  url: string;
  mediaType: "image" | "video";
}

export async function ensureMediaDir(): Promise<string> {
  const dir = mediaDirPath();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Écrit sur disque une image ou vidéo renvoyée en data URI et renvoie
 * l'URL locale permettant de la relire.
 *
 * Les médias générés sont gardés dans ~/.hlstudio/media plutôt qu'en base :
 * un data URI de plusieurs mégaoctets dans SQLite rendrait la lecture de
 * l'historique très lente.
 */
export async function saveDataUri(dataUri: string): Promise<SavedMedia | null> {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUri);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const extension = EXTENSION_BY_MIME[mime];
  if (!extension) return null;

  const dir = await ensureMediaDir();
  const fileName = `${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(dir, fileName), Buffer.from(match[2], "base64"), {
    mode: 0o600,
  });

  return {
    url: `/api/media/${fileName}`,
    mediaType: mime.startsWith("video/") ? "video" : "image",
  };
}

/**
 * Résout un nom de fichier média en chemin disque. Le nom doit correspondre
 * exactement à ce que `saveDataUri` produit : tout le reste est refusé, ce
 * qui exclut par construction les `..`, les séparateurs et les chemins
 * absolus, sans avoir à raisonner sur la normalisation des chemins.
 */
export function resolveMediaFile(fileName: string): { filePath: string; mime: string } | null {
  const match = /^([0-9a-f-]{36})\.([a-z0-9]{2,5})$/i.exec(fileName);
  if (!match) return null;

  const mime = MIME_BY_EXTENSION[match[2].toLowerCase()];
  if (!mime) return null;

  return { filePath: path.join(mediaDirPath(), fileName), mime };
}
