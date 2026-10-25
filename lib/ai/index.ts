import { streamTextAnthropic } from "./protocols/anthropic";
import {
  generateImageGemini,
  generateVideoGemini,
  pollVideoGemini,
  streamTextGemini,
} from "./protocols/gemini";
import { generateImageOpenAi, streamTextOpenAi } from "./protocols/openai";
import {
  ProviderError,
  type AiRequest,
  type AiStreamEvent,
  type GeneratedImage,
  type GeneratedVideo,
} from "./types";
import type { ModelRecord, ProviderRecord } from "@/lib/types";

export * from "./types";

/**
 * Point d'entrée unique pour le texte. Tout le reste de l'application
 * (chat, Mode Agent, bot assistant) passe par ici et ignore quel
 * fournisseur est configuré.
 */
export function streamText(request: AiRequest): AsyncGenerator<AiStreamEvent> {
  switch (request.provider.protocol) {
    case "openai":
      return streamTextOpenAi(request);
    case "anthropic":
      return streamTextAnthropic(request);
    case "gemini":
      return streamTextGemini(request);
    default:
      throw new ProviderError(
        `Protocole non géré : ${String(request.provider.protocol)}.`
      );
  }
}

/** Concatène un flux en une seule chaîne — pour les appels non streamés. */
export async function collectText(request: AiRequest): Promise<string> {
  let out = "";
  for await (const event of streamText(request)) {
    if (event.type === "text") out += event.text;
  }
  return out;
}

export interface MediaRequest {
  provider: ProviderRecord;
  model: ModelRecord;
  prompt: string;
  signal?: AbortSignal;
}

export function generateImage(request: MediaRequest): Promise<GeneratedImage> {
  switch (request.provider.protocol) {
    case "openai":
      return generateImageOpenAi(request);
    case "gemini":
      return generateImageGemini(request);
    case "anthropic":
      throw new ProviderError(
        "Le protocole Anthropic ne propose pas de génération d'images. Ajoute un fournisseur en protocole OpenAI ou Gemini pour le mode Design."
      );
    default:
      throw new ProviderError(
        `Protocole non géré : ${String(request.provider.protocol)}.`
      );
  }
}

export function generateVideo(request: MediaRequest): Promise<GeneratedVideo> {
  if (request.provider.protocol === "gemini") {
    return generateVideoGemini(request);
  }
  // Il n'existe pas d'équivalent standardisé de /chat/completions pour la
  // vidéo : chaque service a son propre schéma. On le dit clairement plutôt
  // que d'envoyer un appel voué à renvoyer un 404 obscur.
  throw new ProviderError(
    `La génération vidéo n'est pas encore implémentée pour le protocole "${request.provider.protocol}". Seul le protocole Gemini (Veo) est géré pour l'instant.`
  );
}

export function pollVideo(
  provider: ProviderRecord,
  jobId: string,
  signal?: AbortSignal
): Promise<GeneratedVideo> {
  if (provider.protocol === "gemini") {
    return pollVideoGemini(provider, jobId, signal);
  }
  throw new ProviderError(
    `Le suivi des tâches vidéo n'est pas géré pour le protocole "${provider.protocol}".`
  );
}
