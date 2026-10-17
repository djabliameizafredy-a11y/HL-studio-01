import type { ChatMessage, ModelResponse } from "@/lib/types";

// Kimi K3 — Moonshot AI, sorti le 16 juillet 2026.
// 2,8T paramètres, MoE, positionné contre Claude Fable 5 pour
// le raisonnement long et la génération de code agentique.
//
// API : compatible OpenAI, même endpoint que Kimi K2.7.
// Base URL : https://api.moonshot.ai/v1
// Modèle : "kimi-k3" (vérifier sur platform.kimi.ai/docs/models)
//
// Clé : KIMI_API_KEY dans .env.local

const KIMI_BASE_URL = "https://api.moonshot.ai/v1";
const KIMI_K3_MODEL = "kimi-k3";

export async function callKimiK3(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<ModelResponse> {
  if (!process.env.KIMI_API_KEY) {
    throw new Error(
      "KIMI_API_KEY manquante — ajoute-la dans .env.local pour utiliser Kimi K3."
    );
  }

  const payload = {
    model: KIMI_K3_MODEL,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 4096,
    temperature: 0.6,
    stream: false,
  };

  const response = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.KIMI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Erreur API Kimi K3 (${response.status}) : ${errText}`
    );
  }

  const data = await response.json();
  const text =
    data.choices?.[0]?.message?.content ??
    "Aucune réponse reçue de Kimi K3.";

  return {
    provider: "kimi-k3",
    text,
  };
}
