import { NextRequest, NextResponse } from "next/server";
import { deleteProvider, updateProvider } from "@/lib/config/store";
import { errorResponse, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

/**
 * Modification d'un fournisseur.
 * PATCH /api/settings/providers/<id>
 *
 * Une `apiKey` vide ou absente laisse la clé existante en place : l'interface
 * ne connaît pas la clé et ne peut donc pas la renvoyer telle quelle.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await readJsonBody(req);
    return NextResponse.json(updateProvider(params.id, body));
  } catch (err) {
    return errorResponse(err, "api/settings/providers/[id]");
  }
}

/**
 * Suppression d'un fournisseur, de ses modèles et des assignations
 * correspondantes.
 * DELETE /api/settings/providers/<id>
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    deleteProvider(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "api/settings/providers/[id]");
  }
}
