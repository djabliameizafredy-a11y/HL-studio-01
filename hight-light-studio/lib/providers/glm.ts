import type { ChatMessage, ModelResponse } from "@/lib/types";

// GLM-5.2 (Zhipu AI / Z.ai) — modèle open-weight (licence MIT), très fort en
// codage et tâches agentiques longues (jusqu'à 1M tokens de contexte).
//
// Deux façons de l'utiliser :
//  1) API directe Z.ai — vérifie l'endpoint et le format exact sur
//     https://docs.z.ai avant de lancer en prod (l'API est compatible
//     avec le format OpenAI chat/completions dans la plupart des cas).
//  2) Plus simple : passer par OpenRouter (https://openrouter.ai), qui
//     héberge GLM-5.2 sous un seul point d'entrée unifié avec Gemma 4 et
//     d'autres modèles open — évite de gérer plusieurs clés API.
//
// Ce fichier est un squelette : à compléter avec ta clé et l'endpoint
// confirmé avant de l'utiliser en production.

const ZAI_API_URL = "https://api.z.ai/api/paas/v4/chat/completions"; // à vérifier
const MODEL_NAME = "glm-5.2";

export async function callGLM(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<ModelResponse> {
  if (!process.env.ZAI_API_KEY) {
    throw new Error(
      "ZAI_API_KEY manquante — ajoute-la dans .env.local (voir lib/providers/glm.ts)"
    );
  }

  const response = await fetch(ZAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        ...messages,
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur API GLM-5.2 : ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";

  return { provider: "glm-5.2", text };
}
