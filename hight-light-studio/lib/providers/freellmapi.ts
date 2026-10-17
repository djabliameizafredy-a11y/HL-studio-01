import type { ChatMessage, ModelResponse, ModelId } from "@/lib/types";

// Intégration de FreeLLMAPI — un proxy local qui unifie plusieurs tiers gratuits.
// Fonctionne comme un endpoint compatible OpenAI, sans clé API requise
// (les clés sont gérées par le proxy FreeLLMAPI local).
//
// URL par défaut si non spécifiée : http://localhost:8080/v1/chat/completions

const FREELLMAPI_URL = process.env.FREELLMAPI_URL || "http://localhost:8080/v1/chat/completions";

export async function callFreeLLMAPI(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<ModelResponse> {
  const payload = {
    model: "auto", // FreeLLMAPI gère le routage par défaut
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 4096,
    temperature: 0.7,
    stream: false,
  };

  const response = await fetch(FREELLMAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Pas de clé d'API requise, le proxy gère l'authentification
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erreur FreeLLMAPI (${response.status}) : ${errText}\nAssurez-vous que le serveur FreeLLMAPI tourne en local sur le port 8080.`);
  }

  const data = await response.json();
  const text =
    data.choices?.[0]?.message?.content ??
    "Aucune réponse reçue de FreeLLMAPI.";

  return {
    provider: "freellmapi",
    text,
  };
}
