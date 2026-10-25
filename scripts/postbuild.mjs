// Après `next build` (output: "standalone"), Next.js NE copie PAS les
// fichiers statiques dans le dossier standalone. Sans cette étape, le
// serveur répond 200 sur "/" mais tous les /_next/static/* renvoient 404
// et la page reste vide dans le navigateur.
import { cp, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const standalone = resolve(root, ".next", "standalone");

await access(standalone).catch(() => {
  console.error("postbuild: .next/standalone introuvable (le build a-t-il réussi ?)");
  process.exit(1);
});

await cp(resolve(root, ".next", "static"), resolve(standalone, ".next", "static"), {
  recursive: true,
});
await cp(resolve(root, "public"), resolve(standalone, "public"), {
  recursive: true,
}).catch(() => {}); // pas de dossier public : normal

console.log("postbuild: fichiers statiques copiés dans .next/standalone/");
