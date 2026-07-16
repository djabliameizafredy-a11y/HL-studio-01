import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveSafePath, WORKSPACE_ROOT, ensureWorkspace } from "./sandbox";

const execAsync = promisify(exec);

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
        await fs.writeFile(filePath, input.content, "utf-8");
        return `Fichier écrit : ${input.path}`;
      }

      case "run_command": {
        const command: string = input.command ?? "";
        if (BLOCKED_PATTERNS.some((pattern) => pattern.test(command))) {
          return "⚠️ Commande refusée par le filet de sécurité minimal (voir lib/agent/tools.ts).";
        }
        const { stdout, stderr } = await execAsync(command, {
          cwd: WORKSPACE_ROOT,
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
        });
        return (stdout + stderr).trim() || "(pas de sortie)";
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
