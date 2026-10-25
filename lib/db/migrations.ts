export interface Migration {
  id: number;
  name: string;
  sql: string;
}

// Les migrations ne sont jamais modifiées après publication : une base déjà
// migrée ne rejoue pas l'ancienne entrée. Toute évolution du schéma passe
// par un nouvel objet à la fin du tableau.
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial",
    sql: `
      CREATE TABLE conversations (
        id         TEXT PRIMARY KEY,
        mode       TEXT NOT NULL CHECK (mode IN ('chat', 'code', 'design', 'video')),
        title      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content         TEXT NOT NULL,
        model_used      TEXT,
        created_at      TEXT NOT NULL
      );

      CREATE TABLE generated_media (
        id         TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        url        TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
        created_at TEXT NOT NULL
      );

      -- Index de lecture de l'historique : /api/history trie toujours les
      -- messages d'une conversation par date de création.
      CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);
      CREATE INDEX idx_media_message ON generated_media (message_id);
      CREATE INDEX idx_conversations_mode ON conversations (mode, updated_at DESC);
    `,
  },
  {
    id: 2,
    name: "agent_sessions",
    sql: `
      -- Trace des tâches du Mode Agent, pour pouvoir relire ce qu'un agent
      -- a fait après coup (les étapes sont stockées en JSON, format libre).
      CREATE TABLE agent_sessions (
        id          TEXT PRIMARY KEY,
        task        TEXT NOT NULL,
        model_used  TEXT,
        status      TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
        steps_json  TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX idx_agent_sessions_created ON agent_sessions (created_at DESC);
    `,
  },
];
