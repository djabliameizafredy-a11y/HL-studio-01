import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// WORKSPACE_ROOT est figé au chargement du module : il faut donc pointer
// l'environnement vers un dossier jetable AVANT le premier import.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "hl-sandbox-"));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hl-outside-"));
process.env.AGENT_WORKSPACE_DIR = root;

const { resolveSafePath, resolveSafePathReal, WORKSPACE_ROOT } = await import(
  "@/lib/agent/sandbox"
);

await fs.writeFile(path.join(outside, "secret.txt"), "clé-api-volée");
await fs.mkdir(path.join(root, "src"), { recursive: true });
await fs.writeFile(path.join(root, "src", "ok.txt"), "contenu");

/** Les symlinks demandent des droits particuliers sous Windows. */
async function canSymlink(): Promise<boolean> {
  const probe = path.join(root, ".symlink-probe");
  try {
    await fs.symlink(path.join(outside, "secret.txt"), probe);
    await fs.unlink(probe);
    return true;
  } catch {
    return false;
  }
}

test("accepte un chemin relatif à l'intérieur du workspace", () => {
  assert.equal(resolveSafePath("src/ok.txt"), path.join(WORKSPACE_ROOT, "src", "ok.txt"));
  assert.equal(resolveSafePath(""), WORKSPACE_ROOT);
  assert.equal(resolveSafePath("."), WORKSPACE_ROOT);
});

test("refuse la remontée de dossier", () => {
  for (const evil of [
    "../secret.txt",
    "../../etc/passwd",
    "src/../../evasion.txt",
    "./././../evasion.txt",
  ]) {
    assert.throws(() => resolveSafePath(evil), /sort du workspace/, `devrait refuser ${evil}`);
  }
});

test("refuse un chemin absolu hors du workspace", () => {
  assert.throws(() => resolveSafePath(path.join(outside, "secret.txt")), /sort du workspace/);
  assert.throws(() => resolveSafePath(path.resolve("/etc/passwd")), /sort du workspace/);
});

test("un dossier voisin au nom préfixé n'est pas considéré comme interne", () => {
  // Piège classique : "<root>-evil" commence bien par "<root>" en texte brut.
  assert.throws(() => resolveSafePath(`${WORKSPACE_ROOT}-evil/x.txt`), /sort du workspace/);
});

test("resolveSafePathReal accepte un fichier existant du workspace", async () => {
  const resolved = await resolveSafePathReal("src/ok.txt");
  assert.equal(resolved, path.join(WORKSPACE_ROOT, "src", "ok.txt"));
});

test("resolveSafePathReal accepte un fichier pas encore créé", async () => {
  const resolved = await resolveSafePathReal("src/nouveau/fichier.txt");
  assert.equal(resolved, path.join(WORKSPACE_ROOT, "src", "nouveau", "fichier.txt"));
});

test("resolveSafePathReal refuse un lien symbolique qui sort du workspace", async (t) => {
  if (!(await canSymlink())) {
    t.skip("création de liens symboliques non autorisée sur cette machine");
    return;
  }
  const link = path.join(root, "fuite.txt");
  await fs.symlink(path.join(outside, "secret.txt"), link);
  try {
    await assert.rejects(resolveSafePathReal("fuite.txt"), /hors du workspace/);
  } finally {
    await fs.unlink(link);
  }
});

test("resolveSafePathReal refuse un fichier dont un ancêtre est un lien sortant", async (t) => {
  if (!(await canSymlink())) {
    t.skip("création de liens symboliques non autorisée sur cette machine");
    return;
  }
  const link = path.join(root, "dossier-lie");
  await fs.symlink(outside, link, "dir");
  try {
    // Le fichier n'existe pas encore : c'est le cas "write_file" qui compte,
    // car c'est lui qui permettrait d'écrire hors zone.
    await assert.rejects(resolveSafePathReal("dossier-lie/nouveau.txt"), /hors du workspace/);
  } finally {
    await fs.unlink(link);
  }
});

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});
