#!/usr/bin/env node

// HL Studio — Point d'entrée CLI
// Usage : npx hlstudio | hlstudio | node bin/hlstudio.js
// Options : --port <number> ou HLSTUDIO_PORT=<number>
//           --workspace <dossier> ou HLSTUDIO_WORKSPACE=<dossier>

import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);

// HL Studio stocke ses données dans SQLite via le module `node:sqlite`,
// disponible sans option depuis Node 23.4 mais encore derrière
// --experimental-sqlite sur Node 22.5 à 23.3. Plutôt que d'imposer Node 24,
// on relance le processus avec l'option quand elle est nécessaire.
function relaunchWithSqliteFlag() {
  if (process.env.HLSTUDIO_SQLITE_RETRY === "1") {
    console.error(
      "❌ Ce Node ne fournit pas le module SQLite intégré (Node 22.5 minimum, 24 recommandé)."
    );
    console.error(`   Version détectée : ${process.versions.node} — mets Node à jour : https://nodejs.org`);
    process.exit(1);
  }

  try {
    require("node:sqlite");
    return false;
  } catch {
    return true;
  }
}

// --- Parse args ---
function hasFlag(name) {
  return process.argv.includes(name);
}

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
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(`HL Studio — studio IA local-first (BYOK)

Usage:
  npx hlstudio [options]
  node bin/hlstudio.js [options]

Options:
  --port <n>          Port du serveur (défaut : premier libre à partir de 3000)
  --workspace <dir>   Dossier de travail de l'agent (défaut : ~/.hlstudio/workspace)
  --no-open           N'ouvre pas le navigateur
  --help, -h          Affiche cette aide

Variables d'environnement (toutes optionnelles) :
  HLSTUDIO_HOME, HLSTUDIO_WORKSPACE, HLSTUDIO_PORT,
  HLSTUDIO_ALLOWED_HOSTS, HL_AGENT_API_KEY, GITHUB_TOKEN
`);
    process.exit(0);
  }

  if (relaunchWithSqliteFlag()) {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      ["--experimental-sqlite", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: "inherit", env: { ...process.env, HLSTUDIO_SQLITE_RETRY: "1" } }
    );
    process.exit(result.status ?? 1);
  }

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
  if (hasFlag("--no-open")) {
    console.log(`  ℹ️  Navigateur non ouvert (--no-open). Ouvre : ${url}`);
  } else if (openFn) {
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
  // Les connexions MCP et le hook session_end sont fermés par le `finally`
  // de runAgent, dans le processus serveur : le CLI n'a pas accès à ces
  // modules (ils vivent dans le bundle Next, pas en tant que fichiers .js).
  function shutdown(signal) {
    console.log(`\n  🛑 Arrêt en cours (${signal})...`);

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
