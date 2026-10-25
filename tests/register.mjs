// Résolveur de modules pour les tests.
//
// Node 24 exécute le TypeScript directement, mais ne sait pas résoudre deux
// choses que le bundler Next gère pour nous :
//   - l'alias "@/..." déclaré dans tsconfig.json ;
//   - les imports sans extension ("./sandbox" au lieu de "./sandbox.ts").
// Ce hook comble les deux, ce qui évite d'ajouter une étape de compilation
// juste pour lancer les tests.
//
// On utilise registerHooks (synchrone, dans le thread courant) et non
// register() : les hooks asynchrones tournent sur un thread séparé, ce qui
// bloque quand un hook fait des accès disque à chaque résolution.

import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

/**
 * Premier candidat qui est un vrai fichier. Le test isFile() est essentiel :
 * sans lui, "@/lib/db" désignerait le dossier lib/db au lieu de son index.
 */
function firstExistingFile(basePath) {
  for (const suffix of SUFFIXES) {
    const candidate = basePath + suffix;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // candidate suivante
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let basePath = null;

    if (specifier.startsWith("@/")) {
      basePath = path.join(ROOT, specifier.slice(2));
    } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      basePath = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }

    if (basePath) {
      const resolved = firstExistingFile(basePath);
      if (resolved) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
