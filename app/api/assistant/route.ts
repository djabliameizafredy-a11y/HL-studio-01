import { NextRequest, NextResponse } from "next/server";
import { collectText } from "@/lib/ai";
import { resolveAssistantModel } from "@/lib/config/store";
import { errorResponse, jsonError, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

// ---------------------------------------------------------------------
// Question posée au bot assistant — STRICTEMENT à la demande.
// Cette route n'est appelée que lorsque l'utilisateur clique sur
// « Envoyer » dans la bulle (après avoir vu qu'elle utilise sa clé API).
// Le bot, lui, n'appelle jamais l'IA tout seul.
//
// - Aucune persistance (pas dans l'historique des conversations).
// - Aucun outil donné au modèle : il ne peut qu'écrire du texte.
// - Réponse courte et limites d'appels, pour protéger la clé de
//   l'utilisateur d'un emballement de l'interface.
// ---------------------------------------------------------------------

const MAX_TOKENS = 350;
const MAX_QUESTION = 300;
const MIN_INTERVAL_MS = 2_000;
const MAX_PER_HOUR = 30;
const PANELS = new Set(["chat", "code", "design", "video"]);

// Compteur global au processus : HL Studio est mono-utilisateur et tourne en
// local, il n'y a donc personne d'autre à cloisonner.
const calls: number[] = [];

const SYSTEM = [
  "Tu es l'assistant d'interface de HL Studio, un espace de travail IA qui tourne en local sur l'ordinateur de l'utilisateur (modes : Chat, Code, Design, Vidéo).",
  "Tu aides à utiliser l'interface. Réponds en français, en 4 phrases maximum, de façon concrète.",
  "Tu ne connais l'interface que par les éléments fournis dans le message : si tu ne sais pas, dis-le au lieu d'inventer.",
  "Ne demande jamais de clé API, de mot de passe ni de donnée personnelle. Tu n'exécutes aucune action : tu expliques seulement.",
].join(" ");

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<{
      question?: unknown;
      panel?: unknown;
      hints?: unknown;
    }>(req);

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return jsonError(400, "La question est vide.");
    if (question.length > MAX_QUESTION) {
      return jsonError(400, `Question trop longue (${MAX_QUESTION} caractères maximum).`);
    }

    const panel =
      typeof body.panel === "string" && PANELS.has(body.panel) ? body.panel : "chat";

    // Les « hints » sont les textes d'aide des éléments visibles, envoyés par
    // le navigateur. Bornés en nombre et en longueur : c'est une entrée non
    // fiable qui finit dans le prompt.
    const hints = (Array.isArray(body.hints) ? body.hints : [])
      .filter((hint): hint is string => typeof hint === "string")
      .slice(0, 12)
      .map((hint) => hint.slice(0, 200));

    const now = Date.now();
    while (calls.length && now - calls[0] > 3_600_000) calls.shift();
    if (calls.length && now - calls[calls.length - 1] < MIN_INTERVAL_MS) {
      return jsonError(429, "Doucement : attends quelques secondes entre deux questions.");
    }
    if (calls.length >= MAX_PER_HOUR) {
      return jsonError(
        429,
        `Limite atteinte (${MAX_PER_HOUR} questions par heure) pour protéger ta clé API.`
      );
    }
    calls.push(now);

    const { provider, model } = resolveAssistantModel();
    const answer = await collectText({
      provider,
      model,
      system: SYSTEM,
      maxTokens: MAX_TOKENS,
      signal: AbortSignal.timeout(30_000),
      messages: [
        {
          role: "user",
          content:
            `Mode actif : ${panel}.\n` +
            "Éléments d'interface visibles et leur aide :\n" +
            `${hints.length ? hints.map((hint) => `- ${hint}`).join("\n") : "(aucun)"}\n\n` +
            `Question de l'utilisateur : ${question}`,
        },
      ],
    });

    return NextResponse.json({
      answer: answer.trim() || "Je n'ai pas de réponse à te donner.",
    });
  } catch (err) {
    return errorResponse(err, "api/assistant");
  }
}
