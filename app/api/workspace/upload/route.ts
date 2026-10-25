import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureWorkspace, resolveSafePath } from "@/lib/agent/sandbox";
import { extractZipBuffer } from "@/lib/workspace/files";
import { errorResponse, jsonError } from "@/lib/api/respond";

export const runtime = "nodejs";

/** Plafond par requête : garde-fou mémoire, tout est bufferisé en RAM. */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/**
 * Import de fichiers dans le workspace.
 * POST /api/workspace/upload (multipart/form-data, champ "files")
 *
 * Un .zip est décompressé ; tout autre fichier est copié tel quel.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files").filter((v): v is File => v instanceof File);

    if (files.length === 0) {
      return jsonError(400, "Aucun fichier reçu (champ \"files\" attendu).");
    }

    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      return jsonError(
        413,
        `Import trop volumineux (${Math.round(total / 1024 / 1024)} Mo). Limite : ${MAX_TOTAL_BYTES / 1024 / 1024} Mo par envoi.`
      );
    }

    await ensureWorkspace();
    const uploaded: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      // `file.name` vient du navigateur : sur certains navigateurs un upload
      // de dossier y met un chemin relatif. On ne garde que le nom final,
      // et resolveSafePath refuse ce qui resterait suspect.
      const safeName = path.basename(file.name).replace(/^\.+/, "");
      if (!safeName) {
        skipped.push(file.name);
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      if (safeName.toLowerCase().endsWith(".zip")) {
        const result = await extractZipBuffer(buffer);
        uploaded.push(`${safeName} (${result.extracted.length} fichiers extraits)`);
        skipped.push(...result.skipped);
        continue;
      }

      const target = resolveSafePath(safeName);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
      uploaded.push(safeName);
    }

    return NextResponse.json({ uploaded, skipped });
  } catch (err) {
    return errorResponse(err, "api/workspace/upload");
  }
}
