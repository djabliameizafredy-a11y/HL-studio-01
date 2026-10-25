import { NextRequest, NextResponse } from "next/server";
import {
  conversationExists,
  getLatestConversationId,
  getMessages,
  listConversations,
} from "@/lib/db/conversations";
import {
  getAgentSession,
  getLatestAgentSession,
  listAgentSessions,
} from "@/lib/db/agentSessions";
import { errorResponse, jsonError } from "@/lib/api/respond";
import { WORKSPACE_MODES, type WorkspaceMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Historique d'un mode.
 * GET /api/history?mode=chat[&conversationId=...]
 * GET /api/history?mode=code[&sessionId=...]
 *
 * Sans identifiant, renvoie la conversation (ou la session Agent) la plus
 * récemment active — ce que les panneaux chargent au montage.
 */
export async function GET(req: NextRequest) {
  try {
    const mode = req.nextUrl.searchParams.get("mode");
    if (!mode || !WORKSPACE_MODES.includes(mode as WorkspaceMode)) {
      return jsonError(
        400,
        `Paramètre 'mode' requis. Valeurs acceptées : ${WORKSPACE_MODES.join(", ")}.`
      );
    }

    if (mode === "code") {
      const requested = req.nextUrl.searchParams.get("sessionId");
      const session =
        (requested && getAgentSession(requested)) || getLatestAgentSession();
      return NextResponse.json({
        session: session
          ? {
              id: session.id,
              task: session.task,
              modelUsed: session.modelUsed,
              status: session.status,
              steps: session.steps,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
            }
          : null,
        sessions: listAgentSessions(),
      });
    }

    const requested = req.nextUrl.searchParams.get("conversationId");
    const conversationId =
      requested && conversationExists(requested)
        ? requested
        : getLatestConversationId(mode as WorkspaceMode);

    if (!conversationId) {
      return NextResponse.json({ conversationId: null, messages: [], conversations: [] });
    }

    return NextResponse.json({
      conversationId,
      messages: getMessages(conversationId),
      conversations: listConversations(mode as WorkspaceMode),
    });
  } catch (err) {
    return errorResponse(err, "api/history");
  }
}
