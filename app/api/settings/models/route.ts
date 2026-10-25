import { NextRequest, NextResponse } from "next/server";
import { addModel } from "@/lib/config/store";
import { errorResponse, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

/**
 * Ajout d'un modèle rattaché à un fournisseur.
 * POST /api/settings/models
 *   { providerId, model, label?, capabilities[], supportsTools? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req);
    return NextResponse.json(addModel(body), { status: 201 });
  } catch (err) {
    return errorResponse(err, "api/settings/models");
  }
}
