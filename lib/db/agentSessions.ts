import { getDb, type SqlRow } from "./index";

export type AgentSessionStatus = "running" | "done" | "error";

export interface AgentSessionSummary {
  id: string;
  task: string;
  modelUsed: string | null;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionRecord extends AgentSessionSummary {
  steps: unknown[];
}

function now(): string {
  return new Date().toISOString();
}

export function createAgentSession(
  id: string,
  task: string,
  modelUsed?: string | null
): void {
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO agent_sessions
         (id, task, model_used, status, steps_json, created_at, updated_at)
       VALUES (?, ?, ?, 'running', '[]', ?, ?)`
    )
    .run(id, task, modelUsed ?? null, timestamp, timestamp);
}

export function appendAgentSessionStep(id: string, step: unknown): void {
  const db = getDb();
  const row = db
    .prepare("SELECT steps_json FROM agent_sessions WHERE id = ?")
    .get(id) as SqlRow | undefined;

  let steps: unknown[] = [];
  if (row && typeof row.steps_json === "string") {
    try {
      const parsed = JSON.parse(row.steps_json);
      if (Array.isArray(parsed)) steps = parsed;
    } catch {
      steps = [];
    }
  }
  steps.push(step);

  db.prepare(
    "UPDATE agent_sessions SET steps_json = ?, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify(steps), now(), id);
}

export function finishAgentSession(
  id: string,
  status: "done" | "error"
): void {
  getDb()
    .prepare(
      "UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?"
    )
    .run(status, now(), id);
}

function toRecord(row: SqlRow): AgentSessionRecord {
  let steps: unknown[] = [];
  if (typeof row.steps_json === "string") {
    try {
      const parsed = JSON.parse(row.steps_json);
      if (Array.isArray(parsed)) steps = parsed;
    } catch {
      steps = [];
    }
  }
  return {
    id: String(row.id),
    task: String(row.task),
    modelUsed: row.model_used === null ? null : String(row.model_used),
    status: row.status as AgentSessionStatus,
    steps,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getAgentSession(id: string): AgentSessionRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM agent_sessions WHERE id = ?")
    .get(id) as SqlRow | undefined;
  return row ? toRecord(row) : null;
}

export function getLatestAgentSession(): AgentSessionRecord | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM agent_sessions ORDER BY updated_at DESC, created_at DESC LIMIT 1"
    )
    .get() as SqlRow | undefined;
  return row ? toRecord(row) : null;
}

export function listAgentSessions(limit = 50): AgentSessionSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, task, model_used, status, created_at, updated_at
         FROM agent_sessions
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ?`
    )
    .all(limit) as SqlRow[];

  return rows.map((row) => ({
    id: String(row.id),
    task: String(row.task),
    modelUsed: row.model_used === null ? null : String(row.model_used),
    status: row.status as AgentSessionStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export function deleteAgentSession(id: string): void {
  getDb().prepare("DELETE FROM agent_sessions WHERE id = ?").run(id);
}
