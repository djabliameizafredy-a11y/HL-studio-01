#!/usr/bin/env node

// HL Studio — Point d'entrée CLI
// Usage : npx hlstudio | hlstudio | node bin/hlstudio.js
// Options : --port <number> ou HLSTUDIO_PORT=<number>
//           --workspace <dossier> ou HLSTUDIO_WORKSPACE=<dossier>

import { createServer } from "node:http";
import { parse } from "node:url";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// --- Parse args ---
function getPort() {
  // 1. --port flag
  const portArgIdx = process.argv.indexOf("--port");
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const p = parseInt(process.argv[portArgIdx + 1], 10);
    if (!isNaN(p) && p > 0 && p < 65536) return p;
  }
  // 2. Env var
  if (process.env.HLSTUDIO_PORT) {
    const p = parseInt(process.env.HLSTUDIO_PORT, 10);
    if (!isNaN(p) && p > 0 && p < 65536) return p;
  }
  // 3. Auto
  return 0; // 0 = let the OS pick
}

// Dossier de travail de l'agent. Priorité : --workspace > HLSTUDIO_WORKSPACE
// > AGENT_WORKSPACE_DIR > ~/.hlstudio/workspace.
// Important : le serveur standalone fait process.chdir() dans son propre
// dossier (le cache npx ou node_modules global) — sans valeur explicite,
// le workspace atterrirait là et serait perdu à chaque mise à jour.
function getWorkspace() {
  const idx = process.argv.indexOf("--workspace");
  const fromFlag = idx !== -1 ? process.argv[idx + 1] : undefined;
  const chosen =
    fromFlag ||
    process.env.HLSTUDIO_WORKSPACE ||
    process.env.AGENT_WORKSPACE_DIR ||
    join(homedir(), ".hlstudio", "workspace");
  const abs = resolve(chosen);
  mkdirSync(abs, { recursive: true });
  return abs;
}

async function main() {
  const requestedPort = getPort();
  process.env.AGENT_WORKSPACE_DIR = getWorkspace();

  // --- Dynamic imports (ESM packages) ---
  let getPortFn;
  try {
    const mod = await import("get-port");
    getPortFn = mod.default;
  } catch {
    // Fallback: si get-port n'est pas dispo, utiliser le port demandé ou 3000
    getPortFn = async (opts) => opts?.port || 3000;
  }

  let openFn;
  try {
    const mod = await import("open");
    openFn = mod.default;
  } catch {
    openFn = null;
  }

  const port = requestedPort || (await getPortFn({ port: [3000, 3001, 3002, 3003, 3004] }));

  // --- Locate the Next.js standalone server ---
  // En mode publié (npm), le build standalone est dans .next/standalone/
  // En mode dev, on fait un fallback sur `next start`
  const standalonePath = resolve(__dirname, "..", ".next", "standalone", "server.js");

  let startServer;

  try {
    // Vérifier si le build standalone existe
    const { accessSync } = await import("node:fs");
    accessSync(standalonePath);

    // Build standalone disponible — l'utiliser directement
    startServer = async () => {
      process.env.PORT = String(port);
      process.env.HOSTNAME = "localhost";
      // Le serveur standalone lit PORT et HOSTNAME depuis env
      await import(pathToFileURL(standalonePath).href);
    };
  } catch {
    // Pas de build standalone — fallback sur `next start` (mode dev)
    const { spawn } = await import("node:child_process");

    startServer = () => {
      return new Promise((resolveP, rejectP) => {
        const nextBin = resolve(__dirname, "..", "node_modules", ".bin", "next");
        const child = spawn(nextBin, ["start", "-p", String(port)], {
          cwd: resolve(__dirname, ".."),
          stdio: "inherit",
          shell: true,
        });

        child.on("error", rejectP);

        // Garder une ref pour le cleanup
        process._hlChild = child;

        // On considère le serveur démarré après un court délai
        setTimeout(() => resolveP(undefined), 2000);
      });
    };
  }

  // --- Banner ---
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║         HL Studio — Local-First      ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");

  // --- Démarrer le serveur ---
  try {
    await startServer();
  } catch (err) {
    console.error("❌ Impossible de démarrer le serveur Next.js :", err.message || err);
    process.exit(1);
  }

  const url = `http://localhost:${port}`;
  console.log(`  ✅ Serveur démarré sur ${url}`);
  console.log(`  📁 Workspace de l'agent : ${process.env.AGENT_WORKSPACE_DIR}`);
  console.log("");

  // --- Ouvrir le navigateur ---
  if (openFn) {
    try {
      await openFn(url);
      console.log("  🌐 Navigateur ouvert automatiquement.");
    } catch {
      console.log(`  ℹ️  Ouvre manuellement : ${url}`);
    }
  } else {
    console.log(`  ℹ️  Ouvre manuellement : ${url}`);
  }

  console.log("  Ctrl+C pour arrêter.");
  console.log("");

  // --- Graceful shutdown ---
  async function shutdown(signal) {
    console.log(`\n  🛑 Arrêt en cours (${signal})...`);

    // Fermer les connexions MCP si elles sont actives
    try {
      const { disconnectMcpServers } = await import("../lib/agent/mcpClient.js");
      await disconnectMcpServers();
      console.log("  ✓ Connexions MCP fermées.");
    } catch {
      // Module pas chargé ou pas de connexions — OK
    }

    // Déclencher les hooks session_end
    try {
      const { executeHooks } = await import("../lib/agent/hooks.js");
      await executeHooks("session_end");
      console.log("  ✓ Hooks session_end exécutés.");
    } catch {
      // Pas de hooks ou erreur — OK
    }

    // Tuer le process enfant si fallback `next start`
    if (process._hlChild) {
      process._hlChild.kill("SIGTERM");
    }

    console.log("  👋 À bientôt !");
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
