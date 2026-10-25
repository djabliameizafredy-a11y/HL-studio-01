import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeEnv } from "@/lib/agent/safeEnv";
import { readConfig } from "@/lib/config/store";

const execFileAsync = promisify(execFile);

/**
 * Nom de branche Git strict : ne commence pas par "-" (sinon Git le lirait
 * comme une option), pas de "..", aucun caractère interprété par le shell.
 */
export function isValidBranchName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 100 &&
    /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock")
  );
}

/** Masque un token dans un texte avant de le renvoyer ou de le logguer. */
export function maskSecrets(text: string, ...secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return out.replace(
    /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|github_pat_[A-Za-z0-9_]{20,}/g,
    "***"
  );
}

export interface GithubRepo {
  owner: string;
  repo: string;
}

/**
 * Extrait owner/repo d'une URL GitHub. L'hôte doit être exactement
 * github.com : sans cette vérification, un dépôt importé dont le remote
 * pointe ailleurs recevrait le token de l'utilisateur.
 */
export function parseGithubRemote(remote: string): GithubRepo | null {
  let host = "";
  let pathname = "";

  const ssh = /^git@([^:]+):(.+)$/.exec(remote);
  if (ssh) {
    host = ssh[1];
    pathname = ssh[2];
  } else {
    try {
      const url = new URL(remote);
      // Un identifiant dans l'URL (https://user:pass@...) signalerait une
      // tentative de faire fuiter ou d'injecter des credentials.
      if (url.protocol !== "https:" || url.username || url.password) return null;
      host = url.hostname;
      pathname = url.pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }

  if (host.toLowerCase() !== "github.com") return null;

  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(
    pathname.replace(/\.git$/, "")
  );
  return match ? { owner: match[1], repo: match[2] } : null;
}

/**
 * Token GitHub : d'abord la configuration locale, sinon la variable
 * d'environnement (pratique en CI, et compatible avec l'ancien .env.local).
 */
export function getGithubToken(): string | null {
  const fromConfig = readConfig().integrations?.githubToken?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  return fromEnv || null;
}

/**
 * Environnement Git portant l'authentification par token.
 *
 * Le token passe par un en-tête HTTP configuré via GIT_CONFIG_*, et non
 * dans l'URL : une URL contenant le token apparaîtrait dans `ps`, dans les
 * logs de Git et dans le fichier .git/config du dépôt cloné.
 */
export function gitAuthEnv(token: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return safeEnv({
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  });
}

/**
 * Échec d'une commande git. Distinguée des autres erreurs pour que les
 * routes puissent remonter le message de Git (« remote rejected »,
 * « repository not found »...) qui est la seule information utile à
 * l'utilisateur. Le message est déjà passé par `maskSecrets`.
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitRunOptions {
  cwd: string;
  token?: string;
  timeoutMs?: number;
}

/**
 * Lance `git` sans shell (execFile) : les arguments sont passés tels quels
 * au binaire, donc aucune injection de commande n'est possible même si un
 * nom de branche ou une URL venait d'un modèle.
 */
export async function runGit(
  args: string[],
  { cwd, token, timeoutMs = 60_000 }: GitRunOptions
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: token ? gitAuthEnv(token) : safeEnv(),
    });
    return (stdout + stderr).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitError(maskSecrets(message, token));
  }
}
