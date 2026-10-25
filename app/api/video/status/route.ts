import { NextRequest, NextResponse } from "next/server";
import { pollVideo } from "@/lib/ai";
import { resolveModelForMode } from "@/lib/config/store";
import { addMedia, addMessage, conversationExists } from "@/lib/db/conversations";
import { errorResponse, jsonError, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

/**
 * Suivi d'une génération vidéo asynchrone.
 * POST /api/video/status  { jobId, conversationId? }
 *
 * La vidéo n'est enregistrée dans l'historique qu'une fois la tâche
 * terminée, pour ne pas y laisser de média introuvable.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<{ jobId?: unknown; conversationId?: unknown }>(req);

    if (typeof body.jobId !== "string" || !body.jobId) {
      return jsonError(400, "Le champ 'jobId' est requis.");
    }

    const { provider, model } = resolveModelForMode("video");
    const result = await pollVideo(provider, body.jobId, AbortSignal.timeout(30_000));

    if (result.status === "pending") {
      return NextResponse.json({ status: "pending" });
    }

    if (
      typeof body.conversationId === "string" &&
      conversationExists(body.conversationId) &&
      result.video
    ) {
      const messageId = addMessage({
        conversationId: body.conversationId,
        role: "assistant",
        content: "Vidéo générée.",
        modelUsed: `${provider.label} / ${model.label}`,
      });
      addMedia(messageId, result.video, "video");
    }

    return NextResponse.json({ status: "done", videoUrl: result.video });
  } catch (err) {
    return errorResponse(err, "api/video/status");
  }
}
