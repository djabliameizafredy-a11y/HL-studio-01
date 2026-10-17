import type { ChatMessage, ModelResponse, ModelId } from "@/lib/types";

// OpenRouter — point d'entrée unifié pour les modèles open-weight (GLM-5.2,
// Gemma 4, etc.). Format compatible OpenAI, une seule clé API.
// Doc : https://openrouter.ai/docs
//
// Pour ajouter un modèle, référence le nom exact depuis :
// https://openrouter.ai/models

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Mapping ModelId → nom de modèle OpenRouter
export const OPENROUTER_MODEL_NAMES: Partial<Record<ModelId, string>> = {
  "glm-5.2": "zhipuai/glm-5.2",
  "gemma-4": "google/gemma-4-27b-it",
  "gemma-4-free": "google/gemma-4-31b-it:free",
  "nemotron-free": "nvidia/nemotron-3-nano-30b-a3b:free",
};

export async function callOpenRouter(
  messages: ChatMessage[],
  modelId: ModelId,
  systemPrompt?: string
): Promise<ModelResponse> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY manquante — ajoute-la dans .env.local (voir lib/providers/openrouter.ts)"
    );
  }

  const modelName = OPENROUTER_MODEL_NAMES[modelId];
  if (!modelName) {
    throw new Error(`Modèle OpenRouter non configuré pour : ${modelId}`);
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://hight-light.com",
      "X-Title": "Hight Light Studio",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Erreur OpenRouter (${response.status}) pour ${modelId} : ${errorBody}`
    );
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";

  return { provider: modelId, text };
}
