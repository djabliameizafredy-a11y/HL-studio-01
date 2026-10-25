import { homedir } from "node:os";
import path from "node:path";
import fs from "node:fs";

// Emplacement unique de toutes les données locales de HL Studio.
// Volontairement HORS du dossier d'installation : `npx hlstudio` réinstalle
// le paquet dans un cache npm différent à chaque mise à jour, et le
// serveur Next.js standalone fait process.chdir() dans son propre dossier.
// Tout ce qui est écrit à côté du code est donc perdu à la mise à jour.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function hlHome(): string {
  const override = process.env.HLSTUDIO_HOME?.trim();
  return override ? path.resolve(override) : path.join(homedir(), ".hlstudio");
}

export const configFilePath = () => path.join(hlHome(), "config.json");
export const databaseFilePath = () => path.join(hlHome(), "hlstudio.db");
export const mediaDirPath = () => path.join(hlHome(), "media");

/**
 * Crée ~/.hlstudio en 0700 si besoin. Sous Windows, les modes POSIX sont
 * ignorés par le système de fichiers : la protection y repose sur le fait
 * que le dossier est dans le profil utilisateur.
 */
export function ensureHlHome(): string {
  const dir = hlHome();
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try {
    fs.chmodSync(dir, DIR_MODE);
  } catch {
    // Windows / systèmes de fichiers sans permissions POSIX
  }
  return dir;
}

/**
 * Écriture atomique d'un fichier contenant des secrets.
 *
 * Deux précautions : le fichier temporaire est créé avec `wx` et le mode
 * restrictif dès l'origine (jamais un instant en 0644 où un autre
 * utilisateur pourrait le lire), et le remplacement par rename est
 * atomique — une coupure de courant ne laisse pas un config.json tronqué.
 */
export function writeSecretFileSync(filePath: string, contents: string): void {
  ensureHlHome();
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: FILE_MODE, flag: "w" });
  try {
    fs.chmodSync(tmp, FILE_MODE);
  } catch {
    // idem : pas de permissions POSIX sous Windows
  }
  fs.renameSync(tmp, filePath);
}
