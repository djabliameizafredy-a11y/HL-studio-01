import { NextRequest } from "next/server";
import { pendingConfirmations } from "@/lib/agent/agentLoop";

function validateApiKey(req: NextRequest): boolean {
  const envKey = process.env.HL_AGENT_API_KEY;
  if (!envKey) return true;
  
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return false;
  
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
      JSON.stringify({ error: 'Authentification requise.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.json();
  const { toolCallId, sessionId, approved } = body;

  if (!toolCallId || !sessionId || typeof approved !== "boolean") {
    return new Response(
      JSON.stringify({ error: "Les champs 'toolCallId' (string), 'sessionId' (string) et 'approved' (boolean) sont requis." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const pending = pendingConfirmations.get(toolCallId);
  if (pending) {
    if (pending.sessionId !== sessionId) {
      return new Response(
        JSON.stringify({ error: "Session invalide." }), 
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    
    pending.resolve(approved);
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response(
    JSON.stringify({ error: "Demande de confirmation non trouvée ou déjà résolue." }), 
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}
