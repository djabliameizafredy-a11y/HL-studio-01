import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ModelResponse } from "@/lib/types";

// Modèles disponibles côté Anthropic (juillet 2026) :
// claude-sonnet-5, claude-opus-4-8, claude-haiku-4-5-20251001, claude-fable-5
// claude-sonnet-5 est un bon défaut : rapide et très capable pour du chat
// général et de l'architecture. Passe à claude-opus-4-8 pour les tâches les
// plus exigeantes (raisonnement long, gros refactors).
const DEFAULT_MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY manquante — ajoute-la dans .env.local"
      );
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function callClaude(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<ModelResponse> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const textBlock = response.content.find((block) => block.type === "text");

  return {
    provider: "claude",
    text: textBlock && textBlock.type === "text" ? textBlock.text : "",
  };
}
