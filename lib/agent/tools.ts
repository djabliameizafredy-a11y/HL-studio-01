import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveSafePathReal, WORKSPACE_ROOT, ensureWorkspace } from "./sandbox";
import { executeHooks } from "./hooks";
import { safeEnv } from "./safeEnv";
import { IsolationError, runIsolatedCommand } from "./openSandbox";
import { executeBrowser, previewUrl, type BrowserAction } from "./browser";
import {
  getGithubToken,
  gitAuthEnv,
  isValidBranchName,
  maskSecrets,
  parseGithubRemote,
} from "@/lib/workspace/github";
import type { AiTool } from "@/lib/ai/types";

const execFileAsync = promisify(execFile);


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
// Les motifs dangereux sont centralisés dans openSandbox.ts
// (inspectCommand) pour que run_command et les hooks partagent le même filet.

// Les schémas sont exprimés dans le format neutre de lib/ai : chaque
// adaptateur de protocole les traduit vers la forme attendue par son API.
export const toolDefinitions: AiTool[] = [
  {
    name: "list_files",
    description:
      "Liste les fichiers et dossiers présents dans le workspace de l'agent.",
    inputSchema: {
      type: "object",
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
    inputSchema: {
      type: "object",
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
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Chemin relatif au workspace." },
        content: { type: "string", description: "Contenu complet du fichier." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command",
    description:
      "Exécute une commande shell dans le workspace (ex: npm install, npm test). Usage restreint — voir lib/agent/tools.ts.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Commande à exécuter." },
      },
      required: ["command"],
    },
  },
  {
    name: "git_create_branch",
    description: "Crée une nouvelle branche Git dans le workspace et bascule dessus.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Nom de la branche à créer." },
      },
      required: ["branch"],
    },
  },
  {
    name: "git_diff",
    description: "Affiche le diff Git (modifications en cours) dans le workspace.",
    inputSchema: {
      type: "object",
      properties: {
        staged: {
          type: "boolean",
          description: "Optionnel. Si true, affiche les modifications indexées (staged).",
        },
      },
    },
  },
  {
    name: "git_create_pr",
    description:
      "Crée une Pull Request sur GitHub via l'API REST. Nécessite un token GitHub enregistré dans les Réglages.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string", description: "Branche source." },
        base: { type: "string", description: "Optionnel. Branche de base (par défaut 'main')." },
      },
      required: ["title", "head"],
    },
  },
  {
    name: "browser",
    description:
      "Automatise un navigateur (Playwright) : ouvrir une page, cliquer, remplir un champ, capturer, inspecter. Désactivé par défaut — l'utilisateur doit l'activer dans Réglages → Isolation. Chaque appel demande une confirmation. Pour contrôler le panneau Preview, ouvre " +
      previewUrl() +
      ".",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["open", "click", "fill", "screenshot", "inspect", "close"],
        },
        url: { type: "string", description: "URL http(s) pour action=open." },
        selector: { type: "string", description: "Sélecteur CSS pour click/fill/inspect." },
        value: { type: "string", description: "Valeur à saisir pour action=fill." },
      },
      required: ["action"],
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

        try {
          const { output, isolation } = await runIsolatedCommand(command);
          return isolation === "local" ? output : `[${isolation}]\n${output}`;
        } catch (err) {
          if (err instanceof IsolationError) {
            return `⚠️ ${err.message}`;
          }
          throw err;
        }
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
        const token = getGithubToken();
        if (!token) {
          throw new Error(
            "Aucun token GitHub enregistré. Ajoute-le dans les Réglages (onglet Intégrations) ou via la variable GITHUB_TOKEN."
          );
        }

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

          // Push vers une URL reconstruite à partir de owner/repo validés,
          // jamais vers l'URL brute du remote.
          await execFileAsync(
            "git",
            ["push", `https://github.com/${owner}/${repo}.git`, `refs/heads/${head}:refs/heads/${head}`],
            { cwd: WORKSPACE_ROOT, timeout: 60_000, env: gitAuthEnv(token) }
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

      case "browser": {
        return await executeBrowser(input as BrowserAction);
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
