import { zipWorkspace } from "@/lib/workspace/files";
import { errorResponse, jsonError } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Téléchargement du workspace en archive .zip.
 * GET /api/workspace/download
 */
export async function GET() {
  try {
    const buffer = await zipWorkspace();

    if (buffer.length === 0) {
      return jsonError(404, "Le workspace est vide : rien à télécharger.");
    }

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(buffer.length),
        // Nom de fichier fixe : le navigateur le renomme côté client avec
        // un horodatage (voir PreviewPane).
        "Content-Disposition": 'attachment; filename="workspace.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err, "api/workspace/download");
  }
}
