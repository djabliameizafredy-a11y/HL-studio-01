import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent/agentLoop";

// ⚠️ Ce endpoint exécute des commandes shell côté serveur (voir
// lib/agent/tools.ts). Ne jamais l'exposer sans authentification.
// Pas d'authentification dans ce scaffold — à ajouter avant tout usage
// au-delà de ta machine locale.

export async function POST(req: NextRequest) {
  const body = await req.json();
  const task = body?.task;

  if (!task || typeof task !== "string") {
    return new Response(
      JSON.stringify({ error: "Le champ 'task' (string) est requis." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const step of runAgent(task)) {
          controller.enqueue(encoder.encode(JSON.stringify(step) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "error", message }) + "\n")
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
