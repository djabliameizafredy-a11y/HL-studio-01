import { randomUUID } from "node:crypto";
import { getDb, type SqlRow } from "./index";
import type {
  GeneratedMedia,
  MessageRole,
  StoredMessage,
  WorkspaceMode,
} from "@/lib/types";

export interface ConversationSummary {
  id: string;
  mode: WorkspaceMode;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

function now(): string {
  return new Date().toISOString();
}

export function createConversation(mode: WorkspaceMode, title?: string): string {
  const id = randomUUID();
  const timestamp = now();
  getDb()
    .prepare(
      "INSERT INTO conversations (id, mode, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, mode, title ?? null, timestamp, timestamp);
  return id;
}

export function conversationExists(id: string): boolean {
  return Boolean(
    getDb().prepare("SELECT 1 FROM conversations WHERE id = ?").get(id)
  );
}

export function getLatestConversationId(mode: WorkspaceMode): string | null {
  const row = getDb()
    .prepare(
      "SELECT id FROM conversations WHERE mode = ? ORDER BY updated_at DESC LIMIT 1"
    )
    .get(mode) as SqlRow | undefined;
  return row ? String(row.id) : null;
}

export function listConversations(
  mode: WorkspaceMode,
  limit = 50
): ConversationSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.mode, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
        WHERE c.mode = ?
        ORDER BY c.updated_at DESC
        LIMIT ?`
    )
    .all(mode, limit) as SqlRow[];

  return rows.map((row) => ({
    id: String(row.id),
    mode: row.mode as WorkspaceMode,
    title: row.title === null ? null : String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    messageCount: Number(row.message_count),
  }));
}

export interface NewMessage {
  conversationId: string;
  role: MessageRole;
  content: string;
  modelUsed?: string | null;
}

export function addMessage(message: NewMessage): string {
  const db = getDb();
  const id = randomUUID();
  const timestamp = now();

  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, model_used, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    message.conversationId,
    message.role,
    message.content,
    message.modelUsed ?? null,
    timestamp
  );

  // updated_at pilote l'ordre des conversations dans l'historique : il doit
  // suivre le dernier message, pas la date de création.
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
    timestamp,
    message.conversationId
  );

  return id;
}

export function addMedia(
  messageId: string,
  url: string,
  mediaType: "image" | "video"
): string {
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO generated_media (id, message_id, url, media_type, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, messageId, url, mediaType, now());
  return id;
}

export function getMessages(conversationId: string): StoredMessage[] {
  const db = getDb();

  const messageRows = db
    .prepare(
      `SELECT id, conversation_id, role, content, model_used, created_at
         FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC`
    )
    .all(conversationId) as SqlRow[];

  if (messageRows.length === 0) return [];

  // Une seule requête pour tous les médias de la conversation, regroupés
  // ensuite en mémoire : évite une requête par message.
  const mediaRows = db
    .prepare(
      `SELECT gm.id, gm.message_id, gm.url, gm.media_type, gm.created_at
         FROM generated_media gm
         JOIN messages m ON m.id = gm.message_id
        WHERE m.conversation_id = ?
        ORDER BY gm.created_at ASC`
    )
    .all(conversationId) as SqlRow[];

  const mediaByMessage = new Map<string, GeneratedMedia[]>();
  for (const row of mediaRows) {
    const messageId = String(row.message_id);
    const list = mediaByMessage.get(messageId) ?? [];
    list.push({
      id: String(row.id),
      messageId,
      url: String(row.url),
      mediaType: row.media_type as "image" | "video",
      createdAt: String(row.created_at),
    });
    mediaByMessage.set(messageId, list);
  }

  return messageRows.map((row) => ({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role as MessageRole,
    content: String(row.content),
    modelUsed: row.model_used === null ? null : String(row.model_used),
    createdAt: String(row.created_at),
    media: mediaByMessage.get(String(row.id)) ?? [],
  }));
}

export function deleteConversation(id: string): void {
  // Les messages et médias partent en cascade (PRAGMA foreign_keys = ON).
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id);
}
