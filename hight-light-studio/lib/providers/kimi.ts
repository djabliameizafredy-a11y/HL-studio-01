import type { ChatMessage, ModelResponse } from "@/lib/types";

// Kimi K2.7-Code (Moonshot AI) — modèle open-weight (licence Modified MIT)
// spécialisé dans le codage agentique long-format : planifie, édite,
// exécute des outils, débogue sur des centaines/milliers d'étapes.
// Contexte de 256K tokens. Le mode "thinking" est toujours actif (pas
// désactivable sur cette version).
//
// C'est un excellent candidat comme alternative — ou complément — à
// GLM-5.2 pour le panneau Code, en particulier pour des sessions agentiques
// longues (refactors multi-fichiers, tests, itération autonome).
//
// Accès : API Kimi (platform.kimi.ai, format compatible OpenAI) ou
// self-hosting des poids depuis Hugging Face (moonshotai/Kimi-K2.7-Code).
// Doc officielle à vérifier avant usage en prod.

const KIMI_API_URL = "https://api.moonshot.ai/v1/chat/completions"; // à vérifier
const MODEL_NAME = "kimi-k2.7-code";

export async function callKimi(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<ModelResponse> {
  if (!process.env.KIMI_API_KEY) {
    throw new Error(
      "KIMI_API_KEY manquante — ajoute-la dans .env.local (voir lib/providers/kimi.ts)"
    );
  }

  const response = await fetch(KIMI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.KIMI_API_KEY}`,
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
    throw new Error(`Erreur API Kimi : ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";

  return { provider: "kimi", text };
}
