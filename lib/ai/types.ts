import type { ModelRecord, ProviderRecord } from "@/lib/types";

/** Outil exposé au modèle, dans une forme indépendante du fournisseur. */
export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema de l'objet d'entrée. */
  inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  /** Identifiant renvoyé par le modèle, à réutiliser dans le résultat. */
  id: string;
  name: string;
  input: unknown;
}

export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AiToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type AiStopReason = "stop" | "tool_calls" | "length";

export type AiStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: AiToolCall }
  | { type: "done"; stopReason: AiStopReason };

export interface AiRequest {
  provider: ProviderRecord;
  model: ModelRecord;
  system?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Erreur remontée par un fournisseur, avec un message déjà présentable à
 * l'utilisateur. `status` sert à distinguer une clé invalide (401) d'un
 * quota dépassé (429) ou d'une panne du service (5xx).
 */
export class ProviderError extends Error {
  readonly status?: number;
  readonly providerLabel?: string;

  constructor(message: string, status?: number, providerLabel?: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.providerLabel = providerLabel;
  }
}

export interface GeneratedImage {
  /** data URI ou URL distante, selon ce que renvoie le fournisseur. */
  image: string;
  text?: string;
}

export interface GeneratedVideo {
  video?: string;
  /** Renseigné quand le fournisseur travaille en asynchrone. */
  jobId?: string;
  status: "done" | "pending";
  text?: string;
}
