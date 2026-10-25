import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// La base vit dans ~/.hlstudio : on la redirige vers un dossier jetable
// avant le premier import, sinon les tests écriraient dans la vraie base.
const home = await fs.mkdtemp(path.join(os.tmpdir(), "hl-db-"));
process.env.HLSTUDIO_HOME = home;

const { getDb, closeDb } = await import("@/lib/db");
const { databaseFilePath } = await import("@/lib/paths");
const repo = await import("@/lib/db/conversations");

test("la base est créée au premier accès, avec WAL et clés étrangères", async () => {
  const db = getDb();
  await fs.access(databaseFilePath());

  const [journal] = db.prepare("PRAGMA journal_mode").all() as Array<Record<string, unknown>>;
  assert.equal(String(journal.journal_mode).toLowerCase(), "wal");

  const [fk] = db.prepare("PRAGMA foreign_keys").all() as Array<Record<string, unknown>>;
  assert.equal(Number(fk.foreign_keys), 1);
});

test("les migrations sont enregistrées et ne rejouent pas", () => {
  const db = getDb();
  const before = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all();
  assert.ok(before.length >= 2, "au moins les migrations initiale et agent_sessions");

  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<Record<string, unknown>>
  ).map((r) => String(r.name));

  for (const expected of ["conversations", "messages", "generated_media", "schema_migrations"]) {
    assert.ok(tables.includes(expected), `table manquante : ${expected}`);
  }

  // Un second appel ne doit pas rejouer les migrations.
  const after = getDb().prepare("SELECT id FROM schema_migrations ORDER BY id").all();
  assert.deepEqual(after, before);
});

test("crée une conversation et relit ses messages dans l'ordre", () => {
  const id = repo.createConversation("chat", "Ma conversation");
  assert.ok(repo.conversationExists(id));

  repo.addMessage({ conversationId: id, role: "user", content: "Bonjour" });
  repo.addMessage({
    conversationId: id,
    role: "assistant",
    content: "Salut",
    modelUsed: "modele-de-test",
  });

  const messages = repo.getMessages(id);
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((m) => [m.role, m.content]),
    [
      ["user", "Bonjour"],
      ["assistant", "Salut"],
    ]
  );
  assert.equal(messages[0].modelUsed, null);
  assert.equal(messages[1].modelUsed, "modele-de-test");
  assert.deepEqual(messages[0].media, []);
});

test("conversationExists est faux pour un identifiant inconnu", () => {
  assert.equal(repo.conversationExists("identifiant-qui-n-existe-pas"), false);
  assert.deepEqual(repo.getMessages("identifiant-qui-n-existe-pas"), []);
});

test("les médias sont rattachés à leur message", () => {
  const id = repo.createConversation("design");
  const messageId = repo.addMessage({
    conversationId: id,
    role: "assistant",
    content: "Voici l'image",
  });
  repo.addMedia(messageId, "/api/media/a.png", "image");
  repo.addMedia(messageId, "/api/media/b.png", "image");

  const [message] = repo.getMessages(id);
  assert.equal(message.media.length, 2);
  assert.deepEqual(
    message.media.map((m) => m.url).sort(),
    ["/api/media/a.png", "/api/media/b.png"]
  );
  assert.equal(message.media[0].mediaType, "image");
});

test("un message refuse de pointer vers une conversation inexistante", () => {
  assert.throws(() =>
    repo.addMessage({ conversationId: "fantome", role: "user", content: "x" })
  );
});

test("l'historique est trié par dernière activité, pas par création", async () => {
  const db = getDb();
  const ancienne = repo.createConversation("video", "Ancienne");
  const recente = repo.createConversation("video", "Récente");

  // Les horodatages sont en ISO à la milliseconde : deux écritures dans la
  // même milliseconde donneraient un ordre indéterminé.
  await new Promise((r) => setTimeout(r, 5));
  repo.addMessage({ conversationId: ancienne, role: "user", content: "réveil" });

  const listed = repo.listConversations("video").map((c) => c.title);
  assert.deepEqual(listed, ["Ancienne", "Récente"]);

  assert.equal(repo.getLatestConversationId("video"), ancienne);
  assert.equal(
    repo.listConversations("video").find((c) => c.id === ancienne)?.messageCount,
    1
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE mode='video'").get()?.n, 2);
});

test("listConversations ne mélange pas les modes", () => {
  repo.createConversation("code", "Tâche de code");
  const codes = repo.listConversations("code");
  assert.ok(codes.every((c) => c.mode === "code"));
  assert.ok(codes.some((c) => c.title === "Tâche de code"));
});

test("supprimer une conversation efface messages et médias en cascade", () => {
  const db = getDb();
  const id = repo.createConversation("chat");
  const messageId = repo.addMessage({ conversationId: id, role: "assistant", content: "x" });
  repo.addMedia(messageId, "/api/media/c.png", "image");

  repo.deleteConversation(id);

  assert.equal(repo.conversationExists(id), false);
  const messages = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE id = ?").get(messageId);
  assert.equal(Number(messages?.n), 0);
  const media = db
    .prepare("SELECT COUNT(*) AS n FROM generated_media WHERE message_id = ?")
    .get(messageId);
  assert.equal(Number(media?.n), 0);
});

test.after(async () => {
  closeDb();
  await fs.rm(home, { recursive: true, force: true });
});
