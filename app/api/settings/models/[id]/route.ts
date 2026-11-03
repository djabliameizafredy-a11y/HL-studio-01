import { NextRequest, NextResponse } from "next/server";
import { deleteModel, updateModel } from "@/lib/config/store";
import { errorResponse, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

/** PATCH /api/settings/models/<id> */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await readJsonBody(req);
    const { id } = await params;
    return NextResponse.json(updateModel(id, body));
  } catch (err) {
    return errorResponse(err, "api/settings/models/[id]");
  }
}

/** DELETE /api/settings/models/<id> — libère aussi les modes qui l'utilisaient. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    deleteModel(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "api/settings/models/[id]");
  }
}
