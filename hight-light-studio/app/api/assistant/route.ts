import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

// ---------------------------------------------------------------------
// Question posée au bot assistant — STRICTEMENT à la demande.
// Cette route n'est appelée que lorsque l'utilisateur clique sur
// « Envoyer » dans la bulle (après avoir vu qu'elle utilise sa clé API).
// Le bot, lui, n'appelle jamais l'IA tout seul.
//
// - Aucune persistance (pas dans l'historique des conversations).
// - Aucun outil donné au modèle : il ne peut qu'écrire du texte.
// - Réponse courte et modèle économique (HL_ASSISTANT_MODEL pour changer).
// - Limites pour protéger la clé de l'utilisateur d'un emballement.
// (Phase C : remplacer process.env par getKey("ANTHROPIC_API_KEY").)
// ---------------------------------------------------------------------

const MODEL = process.env.HL_ASSISTANT_MODEL || "claude-haiku-5-5";
const MAX_TOKENS = 350;
const MAX_QUESTION = 300;
const MIN_INTERVAL_MS = 2_000;
const MAX_PER_HOUR = 30;
const PANELS = new Set(["chat", "code", "design", "video"]);

const calls: number[] = []; // horodatages des appels de la dernière heure

const SYSTEM = [
  "Tu es l'assistant d'interface de HL Studio, un espace de travail IA qui tourne en local sur l'ordinateur de l'utilisateur (modes : Chat, Code, Design, Vidéo).",
  "Tu aides à utiliser l'interface. Réponds en français, en 4 phrases maximum, de façon concrète.",
  "Tu ne connais l'interface que par les éléments fournis dans le message : si tu ne sais pas, dis-le au lieu d'inventer.",
  "Ne demande jamais de clé API, de mot de passe ni de donnée personnelle. Tu n'exécutes aucune action : tu expliques seulement.",
].join(" ");

const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  let body: { question?: unknown; panel?: unknown; hints?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Corps JSON invalide.");
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return fail(400, "La question est vide.");
  if (question.length > MAX_QUESTION) {
    return fail(400, `Question trop longue (${MAX_QUESTION} caractères maximum).`);
  }
  const panel = typeof body.panel === "string" && PANELS.has(body.panel) ? body.panel : "chat";
  const hints = (Array.isArray(body.hints) ? body.hints : [])
    .filter((h): h is string => typeof h === "string")
    .slice(0, 12)
    .map((h) => h.slice(0, 200));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail(
      503,
      "Aucune clé API Anthropic n'est configurée : l'assistant IA est indisponible. Les aides au survol restent actives."
    );
  }

  const now = Date.now();
  while (calls.length && now - calls[0] > 3_600_000) calls.shift();
  if (calls.length && now - calls[calls.length - 1] < MIN_INTERVAL_MS) {
    return fail(429, "Doucement : attends quelques secondes entre deux questions.");
  }
  if (calls.length >= MAX_PER_HOUR) {
    return fail(429, `Limite atteinte (${MAX_PER_HOUR} questions par heure) pour protéger ta clé API.`);
  }
  calls.push(now);

  try {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `Mode actif : ${panel}.\n` +
            `Éléments d'interface visibles et leur aide :\n` +
            `${hints.length ? hints.map((h) => `- ${h}`).join("\n") : "(aucun)"}\n\n` +
            `Question de l'utilisateur : ${question}`,
        },
      ],
    });
    const answer = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
    return NextResponse.json({ answer: answer || "Je n'ai pas de réponse à te donner." });
  } catch (err) {
    console.error("[assistant]", err instanceof Error ? err.name : "erreur");
    return fail(502, "Le fournisseur d'IA n'a pas répondu. Vérifie ta clé API.");
  }
}
