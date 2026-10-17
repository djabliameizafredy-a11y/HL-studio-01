import type { ModelId, ModelResponse, RouteRequestBody, WorkspaceMode } from "@/lib/types";
import { callClaude } from "@/lib/providers/claude";
import { callOpenRouter } from "@/lib/providers/openrouter";
import { callNanoBanana } from "@/lib/providers/nanoBanana";
import { callWan } from "@/lib/providers/wan";
import { callKimi } from "@/lib/providers/kimi";
import { callKimiK3 } from "@/lib/providers/kimiK3";
import { callFreeLLMAPI } from "@/lib/providers/freellmapi";

// Modèle par défaut selon le panneau du workspace utilisé. Ce mapping est
// la première version du "routeur" — la logique peut devenir plus fine
// plus tard (ex: analyser le prompt pour détecter automatiquement le
// meilleur modèle, plutôt que de se baser uniquement sur le panneau actif).
export const DEFAULT_MODEL_BY_MODE: Record<WorkspaceMode, ModelId> = {
  chat: "claude",
  code: "kimi-k3",
  design: "nano-banana",
  video: "wan",
};

// Agents spécialisés : prompts système appliqués par-dessus un modèle
// général plutôt que des modèles séparés (cf. spec technique, section 3).
export const SYSTEM_PROMPTS: Partial<Record<WorkspaceMode, string>> = {
  code: [
    "Tu es l'agent Architecture de Hight Light Studio.",
    "Tu aides à concevoir, structurer et déboguer du code et des systèmes",
    "pour les produits de Hight Light (React, Next.js, TypeScript, Kotlin,",
    "Node.js). Sois précis, propose des structures de dossiers concrètes,",
    "et signale les compromis techniques importants.",
  ].join(" "),
  design: [
    "Tu es l'agent Design de Hight Light Studio.",
    "Tu aides à concevoir des interfaces (mockups, palettes, systèmes de",
    "composants) cohérentes avec l'identité visuelle de chaque produit du",
    "portfolio Hight Light.",
  ].join(" "),
};

export async function routeRequest(body: RouteRequestBody): Promise<ModelResponse> {
  const mode = body.mode ?? "chat";
  const model = body.model ?? DEFAULT_MODEL_BY_MODE[mode];
  const systemPrompt = SYSTEM_PROMPTS[mode];

  switch (model) {
    case "claude":
      return callClaude(body.messages, systemPrompt);
    case "glm-5.2":
    case "gemma-4":
    case "gemma-4-free":
    case "nemotron-free":
      return callOpenRouter(body.messages, model, systemPrompt);
    case "freellmapi":
      return callFreeLLMAPI(body.messages, systemPrompt);
    case "nano-banana":
      return callNanoBanana(body.messages);
    case "wan":
      return callWan(body.messages);
    case "kimi":
      return callKimi(body.messages, systemPrompt);
    case "kimi-k3":
      return callKimiK3(body.messages, systemPrompt);
    default:
      throw new Error(`Modèle inconnu : ${model}`);
  }
}
