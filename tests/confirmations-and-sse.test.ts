import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "hl-ws-"));
process.env.AGENT_WORKSPACE_DIR = workspace;

const {
  awaitConfirmation,
  resolveConfirmation,
  pendingConfirmations,
} = await import("@/lib/agent/agentLoop");
const { parseSse } = await import("@/lib/ai/http");
const { extractZipBuffer, readWorkspaceNode } = await import("@/lib/workspace/files");

test("une confirmation MCP est liée à la session qui l'a émise", async () => {
  const promise = awaitConfirmation("call-1", "session-A", 5_000);
  assert.equal(pendingConfirmations.has("call-1"), true);

  // Une autre session ne peut ni approuver ni refuser la demande.
  assert.equal(resolveConfirmation("call-1", "session-B", true), "wrong_session");
  assert.equal(pendingConfirmations.has("call-1"), true);

  // La session d'origine résout la demande et la retire immédiatement.
  assert.equal(resolveConfirmation("call-1", "session-A", true), "resolved");
  assert.equal(await promise, true);
  assert.equal(pendingConfirmations.has("call-1"), false);

  // Un double-clic / rejeu donne "not_found" au lieu d'un faux succès.
  assert.equal(resolveConfirmation("call-1", "session-A", true), "not_found");
});

test("une confirmation sans réponse expire automatiquement et libère la mémoire", async () => {
  const promise = awaitConfirmation("call-timeout", "session-A", 30);
  assert.equal(pendingConfirmations.has("call-timeout"), true);

  const approved = await promise;
  assert.equal(approved, false);
  assert.equal(pendingConfirmations.has("call-timeout"), false);
});

test("parseSse reconstitue des évènements coupés entre plusieurs paquets TCP", async () => {
  const chunks = [
    "event: content_block_delta\ndata: {\"text\":\"Bon",
    "jour\"}\r\n\r\ndata: ligne 1\ndata: ligne 2\n\n",
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const events: Array<{ event: string | null; data: string }> = [];
  for await (const ev of parseSse(new Response(stream))) {
    events.push(ev);
  }

  assert.deepEqual(events, [
    { event: "content_block_delta", data: '{"text":"Bonjour"}' },
    { event: null, data: "ligne 1\nligne 2" },
  ]);
});

test("extractZipBuffer bloque les entrées Zip-Slip (..) et extrait les fichiers sains", async () => {
  const zip = new AdmZip();
  zip.addFile("src/index.ts", Buffer.from("console.log('ok');", "utf-8"));
  zip.addFile("evasion.txt", Buffer.from("interdit", "utf-8"));
  // AdmZip nettoie les chemins à l'ajout : on réécrit l'en-tête brut comme
  // le ferait une archive forgée pour tenter un Zip-Slip.
  const evilEntry = zip.getEntry("evasion.txt")!;
  evilEntry.entryName = "../../evasion.txt";

  const result = await extractZipBuffer(zip.toBuffer());
  assert.deepEqual(result.extracted, ["src/index.ts"]);
  assert.deepEqual(result.skipped, ["../../evasion.txt"]);

  const node = await readWorkspaceNode("src/index.ts");
  assert.equal(node.type, "file");
  if (node.type === "file") {
    assert.equal(node.content, "console.log('ok');");
  }
});

test.after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});
