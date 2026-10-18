import path from "node:path";
import fs from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveSafePathReal, WORKSPACE_ROOT, ensureWorkspace } from "./sandbox";
import { executeHooks, invalidateHooksCache } from "./hooks";
import { safeEnv } from "./safeEnv";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Nom de branche Git strict : pas de flag (ne commence pas par "-"), pas
// de "..", pas de caractères spéciaux du shell ou de Git.
function isValidBranchName(name: unknown): name is string {
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

// Masque un token (valeur exacte + formats GitHub connus) dans un texte.
function maskSecrets(text: string, ...secrets: (string | undefined)[]): string {
  let out = text;
  for (const sec of secrets) if (sec) out = out.split(sec).join("***");
  return out.replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|github_pat_[A-Za-z0-9_]{20,}/g, "***");
}

// Extrait owner/repo d'un remote GitHub. L'hôte doit être EXACTEMENT
// github.com : sinon le token serait envoyé à n'importe quel serveur
// (ex: un dépôt importé dont "origin" pointe vers un site malveillant).
function parseGithubRemote(remote: string): { owner: string; repo: string } | null {
  let host = "";
  let pathname = "";
  const ssh = remote.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    host = ssh[1];
    pathname = ssh[2];
  } else {
    try {
      const u = new URL(remote);
      if (u.protocol !== "https:" || u.username || u.password) return null;
      host = u.hostname;
      pathname = u.pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }
  if (host.toLowerCase() !== "github.com") return null;
  const m = pathname.replace(/\.git$/, "").match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}


// ⚠️ SÉCURITÉ — LIRE AVANT TOUT DÉPLOIEMENT PUBLIC ⚠️
//
// `run_command` exécute des commandes shell réelles sur la machine qui
// fait tourner le serveur Next.js. Les protections ci-dessous (chemin
// restreint au workspace, liste de motifs bloqués, timeout) sont un filet
// minimal — PAS une vraie sandbox. Une liste de blocage est toujours
// contournable.
//
// Pour un usage interne, en local, sur ta machine : c'est acceptable pour
// prototyper.
//
// Avant toute ouverture publique (Phase 7 de la spec) : remplace
// `run_command` par un vrai environnement isolé par session — par exemple
// E2B (https://e2b.dev), un conteneur Docker éphémère, ou une VM
// Firecracker. Ne JAMAIS exposer /api/agent sans authentification, même en
// interne.
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//, // suppression à la racine
  /sudo/, // élévation de privilèges
  /:\(\)\{.*:\|:.*\};:/, // fork bomb
  /mkfs/, // formatage disque
  /dd\s+if=/, // écriture disque bas niveau
  />\s*\/dev\/sd/, // écriture directe sur un disque
  /curl.*\|\s*sh/, // pipe curl vers shell (téléchargement + exécution)
  /wget.*\|\s*sh/,
];

export const toolDefinitions = [
  {
    name: "list_files",
    description:
      "Liste les fichiers et dossiers présents dans le workspace de l'agent.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Chemin relatif au workspace (racine par défaut).",
        },
      },
    },
  },
  {
    name: "read_file",
    description: "Lit le contenu d'un fichier du workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Chemin relatif au workspace." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Crée ou remplace entièrement un fichier dans le workspace. Crée les dossiers parents si besoin.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command",
    description:
      "Exécute une commande shell dans le workspace (ex: npm install, npm test). Usage restreint — voir lib/agent/tools.ts.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
  },
  {
    name: "git_create_branch",
    description: "Crée une nouvelle branche Git dans le workspace et bascule dessus.",
    input_schema: {
      type: "object" as const,
      properties: {
        branch: { type: "string" },
      },
      required: ["branch"],
    },
  },
  {
    name: "git_diff",
    description: "Affiche le diff Git (modifications en cours) dans le workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        staged: { type: "boolean", description: "Optionnel. Si true, affiche les modifications indexées (staged)." },
      },
    },
  },
  {
    name: "git_create_pr",
    description: "Crée une Pull Request sur GitHub via l'API REST. Nécessite GITHUB_TOKEN.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string", description: "Optionnel. Branche de base (par défaut 'main')." },
      },
      required: ["title", "head"],
    },
  },
];

export async function executeTool(name: string, input: any): Promise<string> {
  await ensureWorkspace();

  try {
    switch (name) {
      case "list_files": {
        const dir = await resolveSafePathReal(input?.path ?? ".");
        const entries = await fs.readdir(dir, { withFileTypes: true });
        if (entries.length === 0) return "(dossier vide)";
        return entries
          .map((e) => `${e.isDirectory() ? "[dir] " : "[file]"} ${e.name}`)
          .join("\n");
      }

      case "read_file": {
        const filePath = await resolveSafePathReal(input.path);
        return await fs.readFile(filePath, "utf-8");
      }

      case "write_file": {
        const filePath = await resolveSafePathReal(input.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        // Sécurité : hooks.json et mcp.json déclenchent de l'exécution de code
        // (scripts de hooks, `command` des serveurs MCP stdio). L'agent ne
        // peut pas les activer lui-même : l'écriture est redirigée vers un
        // fichier .proposed que l'utilisateur doit renommer à la main.
        const relNorm = path
          .relative(WORKSPACE_ROOT, filePath)
          .split(path.sep)
          .join("/")
          .toLowerCase();
        if (relNorm === ".hlstudio/hooks.json" || relNorm === ".hlstudio/mcp.json") {
          const proposedPath = filePath + ".proposed";
          await fs.writeFile(proposedPath, input.content, "utf-8");
          return `⚠️ SÉCURITÉ : Fichier sauvegardé sous ${input.path}.proposed.\nCe fichier déclenche de l'exécution de code : une confirmation humaine est requise. Renomme-le manuellement (en retirant ".proposed") pour l'activer.`;
        }

        await fs.writeFile(filePath, input.content, "utf-8");

        // Hook after_file_write — erreur logguée, jamais bloquant
        try {
          const hookResults = await executeHooks("after_file_write", {
            FILE_PATH: input.path,
          });
          const hookOutput = hookResults
            .filter((r) => r.output)
            .map((r) => `[hook ${r.success ? "✓" : "✗"}] ${r.output}`)
            .join("\n");
          if (hookOutput) {
            return `Fichier écrit : ${input.path}\n${hookOutput}`;
          }
        } catch {
          // Ne jamais bloquer l'écriture à cause d'un hook
        }

        return `Fichier écrit : ${input.path}`;
      }

      case "run_command": {
        const command: string = input.command ?? "";
        if (BLOCKED_PATTERNS.some((pattern) => pattern.test(command))) {
          return "⚠️ Commande refusée par le filet de sécurité minimal (voir lib/agent/tools.ts).";
        }

        // Hook before_command — peut bloquer l'exécution si blocking=true
        try {
          const hookResults = await executeHooks("before_command", {
            COMMAND: command,
          });
          const blocked = hookResults.find((r) => r.blocked);
          if (blocked) {
            return `⛔ Commande bloquée par le hook before_command (${blocked.command}) : ${blocked.output}`;
          }
        } catch {
          // Erreur dans les hooks → on continue quand même
        }

        const { stdout, stderr } = await execAsync(command, {
          cwd: WORKSPACE_ROOT,
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
          env: safeEnv(),
        });
        return (stdout + stderr).trim() || "(pas de sortie)";
      }

      case "git_create_branch": {
        const branch = input.branch;
        if (!isValidBranchName(branch)) {
          throw new Error(
            "Nom de branche invalide (lettres, chiffres, . _ - / ; ne doit pas commencer par un tiret)."
          );
        }
        // execFile : pas de shell, donc aucune injection possible.
        await execFileAsync("git", ["checkout", "-b", branch], {
          cwd: WORKSPACE_ROOT,
          env: safeEnv(),
        });
        return `Branche créée et basculée : ${branch}`;
      }

      case "git_diff": {
        const args = input.staged ? ["diff", "--staged"] : ["diff"];
        const { stdout, stderr } = await execFileAsync("git", args, {
          cwd: WORKSPACE_ROOT,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
          env: safeEnv(),
        });
        return (stdout + stderr).trim() || "(aucun changement)";
      }

      case "git_create_pr": {
        const token = process.env.GITHUB_TOKEN;
        if (!token) throw new Error("GITHUB_TOKEN manquant dans les variables d'environnement.");

        const { title, body, head, base = "main" } = input;
        if (typeof title !== "string" || !title) {
          throw new Error("Le paramètre 'title' est requis.");
        }
        if (!isValidBranchName(head) || !isValidBranchName(base)) {
          throw new Error("Noms de branche 'head'/'base' invalides.");
        }

        try {
          const { stdout: remoteUrlStr } = await execFileAsync(
            "git",
            ["remote", "get-url", "origin"],
            { cwd: WORKSPACE_ROOT, env: safeEnv() }
          );
          const parsed = parseGithubRemote(remoteUrlStr.trim());
          if (!parsed) {
            throw new Error(
              "Le remote 'origin' n'est pas un dépôt github.com : push refusé pour ne pas envoyer le token ailleurs."
            );
          }
          const { owner, repo } = parsed;

          // Push vers une URL reconstruite (jamais celle du remote brut).
          // Le token passe par l'environnement de git (GIT_CONFIG_*), pas
          // dans la ligne de commande (visible dans `ps`) ni dans l'URL.
          const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
          await execFileAsync(
            "git",
            ["push", `https://github.com/${owner}/${repo}.git`, `refs/heads/${head}:refs/heads/${head}`],
            {
              cwd: WORKSPACE_ROOT,
              timeout: 60_000,
              env: safeEnv({
                GIT_TERMINAL_PROMPT: "0",
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "http.extraHeader",
                GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
              }),
            }
          );

          const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title, body, head, base }),
          });

          const data = await response.json();
          if (!response.ok) {
            throw new Error(`Erreur API GitHub : ${JSON.stringify(data)}`);
          }

          return `Pull Request créée : ${data.html_url}`;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          throw new Error(maskSecrets(errMsg, token));
        }
      }

      default:
        return `Outil inconnu : ${name}`;
    }
  } catch (err) {
    return `Erreur lors de l'exécution de ${name} : ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}
