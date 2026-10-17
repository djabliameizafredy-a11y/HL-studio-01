import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveSafePath, WORKSPACE_ROOT, ensureWorkspace } from "./sandbox";
import { executeHooks, invalidateHooksCache } from "./hooks";

const execAsync = promisify(exec);

function sanitizeBranchName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_/]/g, "");
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
        const dir = resolveSafePath(input?.path ?? ".");
        const entries = await fs.readdir(dir, { withFileTypes: true });
        if (entries.length === 0) return "(dossier vide)";
        return entries
          .map((e) => `${e.isDirectory() ? "[dir] " : "[file]"} ${e.name}`)
          .join("\n");
      }

      case "read_file": {
        const filePath = resolveSafePath(input.path);
        return await fs.readFile(filePath, "utf-8");
      }

      case "write_file": {
        const filePath = resolveSafePath(input.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        // Sécurité : l'agent ne peut pas activer de nouveaux hooks lui-même.
        // Si l'agent écrit hooks.json, on le sauvegarde sous hooks.json.proposed
        // L'utilisateur devra le renommer manuellement pour l'activer.
        if (input.path.endsWith("hooks.json")) {
          const proposedPath = filePath + ".proposed";
          await fs.writeFile(proposedPath, input.content, "utf-8");
          return `⚠️ SÉCURITÉ : Fichier sauvegardé sous ${input.path}.proposed.\nLes hooks exécutant du code, une confirmation humaine est requise. Renomme ce fichier en hooks.json manuellement pour l'activer.`;
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
        });
        return (stdout + stderr).trim() || "(pas de sortie)";
      }

      case "git_create_branch": {
        const branch = input.branch;
        if (!branch) throw new Error("Le paramètre 'branch' est requis.");
        await execAsync(`git checkout -b ${sanitizeBranchName(branch)}`, { cwd: WORKSPACE_ROOT });
        return `Branche créée et basculée : ${sanitizeBranchName(branch)}`;
      }

      case "git_diff": {
        const command = input.staged ? "git diff --staged" : "git diff";
        const { stdout, stderr } = await execAsync(command, {
          cwd: WORKSPACE_ROOT,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        });
        return (stdout + stderr).trim() || "(aucun changement)";
      }

      case "git_create_pr": {
        const token = process.env.GITHUB_TOKEN;
        if (!token) throw new Error("GITHUB_TOKEN manquant dans les variables d'environnement.");

        const { title, body, head, base = "main" } = input;
        if (!title || !head) throw new Error("Les paramètres 'title' et 'head' sont requis.");

        try {
          const { stdout: remoteUrlStr } = await execAsync(`git remote get-url origin`, { cwd: WORKSPACE_ROOT });
          const remoteUrl = remoteUrlStr.trim();
          
          let owner = "", repo = "";
          // Parse https://github.com/owner/repo.git or https://github.com/owner/repo
          const githubRegex = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/;
          const match = remoteUrl.match(githubRegex);
          if (match) {
            owner = match[1];
            repo = match[2];
          } else {
            throw new Error(`Impossible de parser l'URL remote : ${remoteUrl}`);
          }

          // Push
          const pushUrl = remoteUrl.replace("https://", `https://${token}@`);
          await execAsync(`git push ${pushUrl} ${head}`, { cwd: WORKSPACE_ROOT });

          // Create PR
          const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/vnd.github.v3+json",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ title, body, head, base })
          });

          const data = await response.json();
          if (!response.ok) {
            throw new Error(`Erreur API GitHub : ${JSON.stringify(data)}`);
          }

          return `Pull Request créée : ${data.html_url}`;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // Sanitize token
          throw new Error(errMsg.replace(/ghp_[A-Za-z0-9]+/g, '***'));
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
