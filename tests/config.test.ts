import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Le store écrit dans ~/.hlstudio : on le redirige vers un dossier jetable
// avant le premier import, sinon les tests toucheraient la vraie config.
const home = await fs.mkdtemp(path.join(os.tmpdir(), "hl-config-"));
process.env.HLSTUDIO_HOME = home;

const store = await import("@/lib/config/store");
const { configFilePath } = await import("@/lib/paths");

const SECRET = "sk-ne-doit-jamais-sortir-1234";

function freshProvider(overrides: Record<string, unknown> = {}) {
  return store.addProvider({
    label: "Fournisseur de test",
    protocol: "openai",
    baseUrl: "https://api.exemple.test/v1",
    apiKey: SECRET,
    ...overrides,
  });
}

test.beforeEach(async () => {
  await fs.rm(configFilePath(), { force: true });
});

test("la config de départ est vide et n'écrit aucun fichier", async () => {
  const config = store.readPublicConfig();
  assert.deepEqual(config.providers, []);
  assert.deepEqual(config.models, []);
  assert.deepEqual(config.assignments, { chat: null, code: null, design: null, video: null });
  await assert.rejects(fs.access(configFilePath()));
});

test("la vue publique ne contient jamais la clé d'API", () => {
  freshProvider();
  const published = store.readPublicConfig();
  const [provider] = published.providers;

  assert.equal(provider.hasApiKey, true);
  assert.equal(provider.apiKeyHint, "1234");
  assert.equal((provider as Record<string, unknown>).apiKey, undefined);
  // Garde-fou global : la clé ne doit apparaître nulle part dans ce qui
  // part vers le navigateur, même via un champ ajouté plus tard.
  assert.ok(!JSON.stringify(published).includes(SECRET));
});

test("le token GitHub n'est exposé que comme un booléen", () => {
  store.setGithubToken("ghp_token_de_test_abcdef");
  const published = store.readPublicConfig();
  assert.deepEqual(published.integrations, { hasGithubToken: true });
  assert.ok(!JSON.stringify(published).includes("ghp_token_de_test_abcdef"));

  store.setGithubToken("");
  assert.equal(store.readPublicConfig().integrations.hasGithubToken, false);
});

test("le fichier de config est écrit en JSON lisible et relu correctement", async () => {
  const created = freshProvider({ label: "Relecture" });
  const onDisk = JSON.parse(await fs.readFile(configFilePath(), "utf-8"));
  assert.equal(onDisk.providers[0].apiKey, SECRET);
  assert.equal(onDisk.providers[0].id, created.id);
});

test("refuse une URL non https sauf vers localhost", () => {
  assert.throws(
    () => freshProvider({ baseUrl: "http://api.exemple.test/v1" }),
    store.ConfigValidationError
  );
  assert.throws(() => freshProvider({ baseUrl: "pas-une-url" }), store.ConfigValidationError);

  // Ollama / LM Studio tournent en http sur la machine locale.
  const local = freshProvider({ baseUrl: "http://localhost:11434/v1" });
  assert.equal(local.baseUrl, "http://localhost:11434/v1");
});

test("refuse un protocole inconnu et un label vide", () => {
  assert.throws(() => freshProvider({ protocol: "mistral" }), store.ConfigValidationError);
  assert.throws(() => freshProvider({ label: "   " }), store.ConfigValidationError);
});

test("une mise à jour sans clé conserve la clé existante", () => {
  const provider = freshProvider();
  store.updateProvider(provider.id, { label: "Nouveau nom", apiKey: "" });

  const { provider: resolvedProvider } = (() => {
    const model = store.addModel({
      providerId: provider.id,
      model: "modele-x",
      capabilities: ["text"],
    });
    return store.resolveModelById(model.id);
  })();

  assert.equal(resolvedProvider.label, "Nouveau nom");
  assert.equal(resolvedProvider.apiKey, SECRET);
});

test("supprimer un fournisseur supprime ses modèles et libère les modes", () => {
  const provider = freshProvider();
  const model = store.addModel({
    providerId: provider.id,
    model: "modele-texte",
    capabilities: ["text"],
  });
  store.setAssignment("chat", model.id);
  store.setAssistantModel(model.id);
  assert.equal(store.readPublicConfig().assignments.chat, model.id);

  store.deleteProvider(provider.id);

  const after = store.readPublicConfig();
  assert.deepEqual(after.providers, []);
  assert.deepEqual(after.models, []);
  assert.equal(after.assignments.chat, null);
  assert.equal(after.assistantModelId, null);
});

test("refuse un modèle rattaché à un fournisseur inexistant", () => {
  assert.throws(
    () => store.addModel({ providerId: "inconnu", model: "m", capabilities: ["text"] }),
    store.ConfigValidationError
  );
});

test("refuse une capacité inconnue ou une liste vide", () => {
  const provider = freshProvider();
  assert.throws(
    () => store.addModel({ providerId: provider.id, model: "m", capabilities: [] }),
    store.ConfigValidationError
  );
  assert.throws(
    () => store.addModel({ providerId: provider.id, model: "m", capabilities: ["son"] }),
    store.ConfigValidationError
  );
});

test("un mode refuse un modèle qui n'a pas la capacité correspondante", () => {
  const provider = freshProvider();
  const videoModel = store.addModel({
    providerId: provider.id,
    model: "modele-video",
    capabilities: ["video"],
  });

  assert.throws(() => store.setAssignment("chat", videoModel.id), store.ConfigValidationError);
  assert.throws(() => store.setAssignment("design", videoModel.id), store.ConfigValidationError);
  store.setAssignment("video", videoModel.id);
  assert.equal(store.readPublicConfig().assignments.video, videoModel.id);
});

test("le mode Code exige un modèle capable d'appeler des outils", () => {
  const provider = freshProvider();
  const sansOutils = store.addModel({
    providerId: provider.id,
    model: "modele-code",
    capabilities: ["text", "code"],
    supportsTools: false,
  });

  assert.throws(() => store.setAssignment("code", sansOutils.id), store.ConfigValidationError);

  store.updateModel(sansOutils.id, { supportsTools: true });
  store.setAssignment("code", sansOutils.id);
  assert.equal(store.readPublicConfig().assignments.code, sansOutils.id);
});

test("resolveModelForMode refuse un override incompatible venant du client", () => {
  const provider = freshProvider();
  const text = store.addModel({
    providerId: provider.id,
    model: "texte",
    capabilities: ["text"],
  });
  const image = store.addModel({
    providerId: provider.id,
    model: "image",
    capabilities: ["image"],
  });
  store.setAssignment("chat", text.id);

  assert.equal(store.resolveModelForMode("chat").model.id, text.id);
  // Le navigateur n'est pas une source de confiance : l'override est revalidé.
  assert.throws(() => store.resolveModelForMode("chat", image.id), store.ConfigValidationError);
});

test("resolveModelById refuse un fournisseur sans clé", () => {
  const provider = freshProvider({ apiKey: "" });
  const model = store.addModel({
    providerId: provider.id,
    model: "texte",
    capabilities: ["text"],
  });
  assert.throws(() => store.resolveModelById(model.id), /Aucune clé d'API/);
});

test("un mode sans modèle donne une erreur qui renvoie vers les Réglages", () => {
  assert.throws(() => store.resolveModelForMode("chat"), /Réglages/);
  assert.throws(() => store.resolveAssistantModel(), /Réglages/);
});

test("un config.json corrompu n'est pas écrasé", async () => {
  freshProvider();
  const corrupted = "{ ceci n'est pas du JSON";
  await fs.writeFile(configFilePath(), corrupted);

  assert.throws(() => store.readConfig(), /illisible/);
  // La clé de l'utilisateur ne doit pas disparaître sous prétexte d'une faute de frappe.
  assert.equal(await fs.readFile(configFilePath(), "utf-8"), corrupted);
});

test.after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});
