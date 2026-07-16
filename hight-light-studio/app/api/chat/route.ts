import { NextRequest, NextResponse } from "next/server";
import { routeRequest } from "@/lib/modelRouter";
import type { RouteRequestBody } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RouteRequestBody;

    if (!body.messages || body.messages.length === 0) {
      return NextResponse.json(
        { error: "Le champ 'messages' est requis." },
        { status: 400 }
      );
    }

    const result = await routeRequest(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
