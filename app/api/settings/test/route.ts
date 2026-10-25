import { NextRequest, NextResponse } from "next/server";
import { resolveModelById } from "@/lib/config/store";
import { testModel } from "@/lib/ai/test";
import { errorResponse, jsonError, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

/**
 * Vérifie qu'un modèle répond réellement.
 * POST /api/settings/test  { modelId }
 *
 * Le test consomme des tokens sur le compte de l'utilisateur : il n'est
 * déclenché que par un clic explicite sur « Tester » dans les Réglages.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<{ modelId?: unknown }>(req);
    if (typeof body.modelId !== "string" || !body.modelId) {
      return jsonError(400, "Le champ 'modelId' est requis.");
    }

    const { provider, model } = resolveModelById(body.modelId);
    return NextResponse.json(await testModel(provider, model));
  } catch (err) {
    return errorResponse(err, "api/settings/test");
  }
}
