import type { ChatMessage, ModelResponse } from "@/lib/types";

// Gemma 4 (Google DeepMind) — modèle open-weight sous licence Apache 2.0.
// Idéal pour des tâches légères, rapides, ou du usage local/mobile plus
// tard (déclinaisons E2B/E4B pour l'embarqué).
//
// Hébergé ici via NVIDIA NIM (https://build.nvidia.com), qui expose Gemma 4
// et d'autres modèles open-source sous forme de microservices avec une API
// compatible OpenAI. Vérifie le nom exact du modèle sur le catalogue NVIDIA
// avant de lancer en prod.

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"; // à vérifier
const MODEL_NAME = "google/gemma-4-31b-it"; // à vérifier sur build.nvidia.com

export async function callGemma(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<ModelResponse> {
  if (!process.env.NVIDIA_API_KEY) {
    throw new Error(
      "NVIDIA_API_KEY manquante — ajoute-la dans .env.local (voir lib/providers/gemma.ts)"
    );
  }

  const response = await fetch(NVIDIA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
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
    throw new Error(`Erreur API Gemma 4 (NVIDIA NIM) : ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";

  return { provider: "gemma-4", text };
}
