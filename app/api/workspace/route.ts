import { NextRequest, NextResponse } from "next/server";
import { readWorkspaceNode } from "@/lib/workspace/files";
import { errorResponse, jsonError } from "@/lib/api/respond";

export const runtime = "nodejs";
// Le contenu du workspace change à chaque action de l'agent : aucune
// réponse ne doit être mise en cache par Next.
export const dynamic = "force-dynamic";

/**
 * Navigateur de fichiers du panneau Preview.
 * GET /api/workspace?path=src/index.ts
 */
export async function GET(req: NextRequest) {
  const relativePath = req.nextUrl.searchParams.get("path") ?? "";

  try {
    return NextResponse.json(await readWorkspaceNode(relativePath));
  } catch (err) {
    // Chemin refusé par le bac à sable, ou fichier inexistant : dans les
    // deux cas c'est une erreur de requête, pas une panne du serveur.
    if (err instanceof Error && /Chemin refusé/.test(err.message)) {
      return jsonError(403, err.message);
    }
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return jsonError(404, `Introuvable dans le workspace : ${relativePath || "/"}`);
    }
    return errorResponse(err, "api/workspace");
  }
}
