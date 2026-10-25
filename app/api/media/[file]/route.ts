import fs from "node:fs/promises";
import { resolveMediaFile } from "@/lib/media/store";
import { jsonError } from "@/lib/api/respond";

export const runtime = "nodejs";

/**
 * Sert une image ou une vidéo générée, stockée dans ~/.hlstudio/media.
 * GET /api/media/<uuid>.<ext>
 */
export async function GET(
  _req: Request,
  { params }: { params: { file: string } }
) {
  const resolved = resolveMediaFile(params.file);
  if (!resolved) {
    return jsonError(400, "Nom de fichier média invalide.");
  }

  let data: Buffer;
  try {
    data = await fs.readFile(resolved.filePath);
  } catch {
    return jsonError(404, "Média introuvable.");
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": resolved.mime,
      "Content-Length": String(data.length),
      // Le nom contient un UUID : le contenu ne change jamais, on peut le
      // mettre en cache agressivement côté navigateur.
      "Cache-Control": "private, max-age=31536000, immutable",
      // Défense en profondeur : même si une extension inattendue passait,
      // le navigateur ne doit pas réinterpréter le type.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
