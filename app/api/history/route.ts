import { NextRequest, NextResponse } from "next/server";
import {
  conversationExists,
  getLatestConversationId,
  getMessages,
  listConversations,
} from "@/lib/db/conversations";
import { errorResponse, jsonError } from "@/lib/api/respond";
import { WORKSPACE_MODES, type WorkspaceMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Historique d'un mode.
 * GET /api/history?mode=chat[&conversationId=...]
 *
 * Sans conversationId, renvoie la conversation la plus récemment active du
 * mode — ce que les panneaux chargent au montage.
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
