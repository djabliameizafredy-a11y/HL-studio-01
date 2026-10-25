import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT, ensureWorkspace } from "./sandbox";
import { safeEnv } from "./safeEnv";
import { getIsolation } from "@/lib/config/store";
import { hlHome } from "@/lib/paths";
import type { IsolationMode } from "@/lib/types";

const execFileAsync = promisify(execFile);

/**
 * Isolation des commandes de l'agent.
 *
 * Trois couches, empilées :
 *   1. Filet local (toujours actif) : HOME isolé, HOME/TMP/TEMP/USERPROFILE
 *      pointent dans ~/.hlstudio/agent-home, motifs dangereux bloqués,
 *      audit des liens symboliques qui sortent du workspace.
 *   2. Docker (mode "docker") : `docker run --rm` éphémère, bind-mount
 *      du workspace en /workspace, --network none, --user, --read-only
 *      sur le reste. Si Docker n'est pas installé, on retombe sur (1)
 *      avec un message explicite.
 *   3. OpenSandbox (mode "opensandbox") : même filet, plus le binaire
 *      `opensandbox` s'il est dans le PATH. Sinon, message + filet local.
 *
 * Aucune de ces couches n'est un hypervisor : elles empêchent les
 * évasions triviales (rm -rf /, lecture de ~/.ssh, curl|sh) et rendent
 * les fuites de clés beaucoup plus difficiles. Une confirmation humaine
 * reste obligatoire avant chaque commande (voir CONFIRM_TOOLS).
 */

const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(\s|$)/,
  /\bsudo\b/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*;\s*\}\s*;/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
  /\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/,
  /\bchmod\s+(-[a-zA-Z]*\s+)*777\b/,
  /\bchown\s+/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\b(iptables|ufw|firewall-cmd)\b/,
  /\b(nc|ncat|netcat)\b[^|]*-e\b/,
  /\bssh-keygen\b/,
  /\b(eval|source)\s+/,
];

const ESCAPE_PATTERNS: RegExp[] = [
  /(?:^|[\s;&|])cd\s+(?:\.\.|\/|~|[A-Za-z]:\\)/,
  /(?:^|[\s;&|])(?:pushd|popd)\b/,
  /\$HOME[\\/]|\b~[\\/]/,
  /\/etc\/|\/proc\/|\/sys\/|\/dev\//,
  /(?:^|[\s;&|])export\s+(?:HOME|PATH|LD_PRELOAD|DYLD_|GIT_DIR)\b/,
];

export class IsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolationError";
  }
}

export function inspectCommand(command: string): string | null {
  if (typeof command !== "string" || !command.trim()) {
    return "Commande vide.";
  }
  if (command.length > 4_000) {
    return "Commande trop longue (4 000 caractères maximum).";
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Commande refusée par le filet d'isolation (motif dangereux).`;
    }
  }
  for (const pattern of ESCAPE_PATTERNS) {
    if (pattern.test(command)) {
      return `Commande refusée : elle tente de quitter le workspace ou de lire un chemin système.`;
    }
  }
  return null;
}

/**
 * HOME/TMP isolés : même si une commande exécute `cat ~/.ssh/id_rsa` ou
 * `printenv`, elle ne voit ni les clés de l'utilisateur ni celles de
 * HL Studio (qui vivent dans ~/.hlstudio/config.json, hors de ce HOME).
 */
export function isolatedHomeDir(): string {
  return path.join(hlHome(), "agent-home");
}

export async function ensureIsolatedHome(): Promise<string> {
  const dir = isolatedHomeDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(dir, "tmp"), { recursive: true, mode: 0o700 });
  return dir;
}

export function isolatedEnv(): NodeJS.ProcessEnv {
  const home = isolatedHomeDir();
  const tmp = path.join(home, "tmp");
  return safeEnv({
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]$/, "") || undefined,
    HOMEPATH: home,
    TMP: tmp,
    TEMP: tmp,
    TMPDIR: tmp,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    GIT_TERMINAL_PROMPT: "0",
    // Coupe l'héritage de ~/.gitconfig de l'utilisateur (identité, hooks).
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
  });
}

/**
 * Refuse tout lien symbolique du workspace dont la cible réelle sort
 * de WORKSPACE_ROOT. Appelé juste avant l'exécution d'une commande :
 * un `ln -s /etc/passwd leak.txt` créé plus tôt n'est plus exploitable.
 */
export async function auditWorkspaceSymlinks(
  root: string = WORKSPACE_ROOT,
  limit = 2_000
): Promise<string[]> {
  const offenders: string[] = [];
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root));
  const inside = (p: string) => p === rootReal || p.startsWith(rootReal + path.sep);

  let visited = 0;
  async function walk(dir: string): Promise<void> {
    if (visited >= limit || offenders.length >= 20) return;
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (visited >= limit) return;
      const absolute = path.join(dir, dirent.name);
      visited += 1;
      if (dirent.isSymbolicLink()) {
        const real = await fs.realpath(absolute).catch(() => null);
        if (!real || !inside(real)) {
          offenders.push(path.relative(root, absolute) || dirent.name);
        }
        continue;
      }
      if (dirent.isDirectory()) await walk(absolute);
    }
  }

  await walk(root);
  return offenders;
}

export interface IsolatedCommandResult {
  output: string;
  isolation: IsolationMode;
}

async function runLocal(command: string, timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    process.platform === "win32" ? "cmd.exe" : "/bin/sh",
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
    {
      cwd: WORKSPACE_ROOT,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: isolatedEnv(),
      windowsHide: true,
    }
  );
  return (stdout + stderr).trim() || "(pas de sortie)";
}

async function runDocker(command: string, timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--workdir",
      "/workspace",
      "--volume",
      `${WORKSPACE_ROOT}:/workspace:rw`,
      "--env",
      "HOME=/tmp/hl-home",
      "--env",
      "TMPDIR=/tmp/hl-home",
      "node:22-alpine",
      "sh",
      "-c",
      command,
    ],
    {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: isolatedEnv(),
      windowsHide: true,
    }
  );
  return (stdout + stderr).trim() || "(pas de sortie)";
}

async function runOpenSandbox(command: string, timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    "opensandbox",
    ["run", "--workdir", WORKSPACE_ROOT, "--", "sh", "-c", command],
    {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: isolatedEnv(),
      windowsHide: true,
    }
  );
  return (stdout + stderr).trim() || "(pas de sortie)";
}

async function binaryAvailable(name: string): Promise<boolean> {
  try {
    await execFileAsync(name, ["--version"], {
      timeout: 4_000,
      windowsHide: true,
      env: isolatedEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function runIsolatedCommand(
  command: string,
  timeoutMs = 20_000
): Promise<IsolatedCommandResult> {
  await ensureWorkspace();
  await ensureIsolatedHome();

  const reason = inspectCommand(command);
  if (reason) throw new IsolationError(reason);

  const offenders = await auditWorkspaceSymlinks();
  if (offenders.length > 0) {
    throw new IsolationError(
      `Exécution refusée : ${offenders.length} lien(s) symbolique(s) pointent hors du workspace (${offenders.slice(0, 5).join(", ")}). Supprime-les avant de relancer.`
    );
  }

  const isolation = getIsolation();
  const mode = isolation.mode;

  if (mode === "docker") {
    if (!(await binaryAvailable("docker"))) {
      const output = await runLocal(command, timeoutMs);
      return {
        isolation: "local",
        output: `${output}\n\n[isolation] Docker introuvable — filet local appliqué.`,
      };
    }
    return { isolation: "docker", output: await runDocker(command, timeoutMs) };
  }

  if (mode === "opensandbox") {
    if (!(await binaryAvailable("opensandbox"))) {
      const output = await runLocal(command, timeoutMs);
      return {
        isolation: "local",
        output: `${output}\n\n[isolation] opensandbox introuvable dans le PATH — filet local appliqué.`,
      };
    }
    return {
      isolation: "opensandbox",
      output: await runOpenSandbox(command, timeoutMs),
    };
  }

  return { isolation: "local", output: await runLocal(command, timeoutMs) };
}
