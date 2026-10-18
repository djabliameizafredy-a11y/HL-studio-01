import { NextRequest } from "next/server";
import { runAgent, autoApproveSessions } from "@/lib/agent/agentLoop";
import { runParallelAgents, SubAgentConfig } from "@/lib/agent/parallelAgents";

// ⚠️ Ce endpoint exécute des commandes shell côté serveur (voir
// lib/agent/tools.ts). Ne jamais l'exposer sans authentification.
// Pas d'authentification dans ce scaffold — à ajouter avant tout usage
// au-delà de ta machine locale.

function validateApiKey(req: NextRequest): boolean {
  const envKey = process.env.HL_AGENT_API_KEY;
  // Si pas de clé configurée, autoriser uniquement les requêtes locales
  if (!envKey) return true;
  
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return false;
  
  // Comparaison en temps constant pour éviter les timing attacks
  if (token?.length !== envKey.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ envKey.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) {
    return new Response(
      JSON.stringify({ error: 'Authentification requise. Ajoute Authorization: Bearer <HL_AGENT_API_KEY> dans les headers.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.json();
  const task = body?.task;
  const parallelConfig = body?.parallel as SubAgentConfig[] | undefined;
  
  // Utiliser le sessionId fourni par le client, ou en générer un nouveau
  const sessionId = body?.sessionId || crypto.randomUUID();

  if (!task || typeof task !== "string") {
    return new Response(
      JSON.stringify({ error: "Le champ 'task' (string) est requis." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Auto-approbation des commandes pour CETTE session uniquement (les
  // outils MCP demandent toujours une confirmation).
  if (body?.autoApprove === true) autoApproveSessions.add(sessionId);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Envoyer le sessionId au client dès le début de la session
      controller.enqueue(encoder.encode(JSON.stringify({ type: "session_id", sessionId }) + "\n"));

      try {
        const agentGenerator = parallelConfig && Array.isArray(parallelConfig) && parallelConfig.length > 0
          ? runParallelAgents(task, sessionId, parallelConfig)
          : runAgent(task, sessionId);

        for await (const step of agentGenerator) {
          controller.enqueue(encoder.encode(JSON.stringify(step) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "error", message }) + "\n")
        );
      } finally {
        autoApproveSessions.delete(sessionId);
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
