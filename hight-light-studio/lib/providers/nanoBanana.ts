import type { ChatMessage, ModelResponse } from "@/lib/types";

// Nano Banana / Nano Banana Pro — modèles de génération et d'édition
// d'images de Google, construits sur Gemini. Accessibles via l'API Gemini.
// Doc officielle : https://ai.google.dev/gemini-api/docs/image-generation
//
// Modèles disponibles (juillet 2026) :
//  - gemini-3.1-flash-lite-image (Nano Banana 2 Lite) — rapide, peu coûteux
//  - gemini-3.1-flash-image (Nano Banana 2) — bon équilibre qualité/vitesse
//  - gemini-3-pro-image (Nano Banana Pro) — le plus avancé, texte lisible
//    dans les images, idéal pour mockups/maquettes UI
//
// Pour du prototypage UI (écrans d'app, mockups), Nano Banana Pro est le
// meilleur choix vu sa précision sur le texte et les mises en page.

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent"; // à vérifier

export async function callNanoBanana(
  messages: ChatMessage[]
): Promise<ModelResponse> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY manquante — ajoute-la dans .env.local (voir lib/providers/nanoBanana.ts)"
    );
  }

  const lastPrompt = messages[messages.length - 1]?.content ?? "";

  const response = await fetch(`${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: lastPrompt }] }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur API Nano Banana : ${response.status}`);
  }

  const data = await response.json();
  // La structure exacte de la réponse (base64 image dans les parts) est à
  // confirmer avec la doc officielle au moment de l'implémentation réelle.
  const imageUrl = data.candidates?.[0]?.content?.parts?.find(
    (p: any) => p.inlineData
  )?.inlineData?.data;

  return {
    provider: "nano-banana",
    text: "Image générée.",
    imageUrl,
  };
}
