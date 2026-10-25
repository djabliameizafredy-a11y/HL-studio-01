import { NextRequest, NextResponse } from "next/server";
import { addProvider } from "@/lib/config/store";
import { errorResponse, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

/**
 * Ajout d'un fournisseur d'IA.
 * POST /api/settings/providers  { label, protocol, baseUrl, apiKey }
 *
 * La réponse ne contient jamais la clé, seulement ses 4 derniers caractères.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req);
    return NextResponse.json(addProvider(body), { status: 201 });
  } catch (err) {
    return errorResponse(err, "api/settings/providers");
  }
}
