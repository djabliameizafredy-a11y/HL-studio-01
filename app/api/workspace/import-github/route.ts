import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_ROOT, ensureWorkspace } from "@/lib/agent/sandbox";
import { clearWorkspace, countWorkspaceFiles } from "@/lib/workspace/files";
import { getGithubToken, parseGithubRemote, runGit } from "@/lib/workspace/github";
import { errorResponse, jsonError, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";

/**
 * Import d'un dépôt GitHub dans le workspace.
 * POST /api/workspace/import-github  { repoUrl, confirm }
 *
 * Le workspace étant unique, un import l'écrase : on renvoie d'abord
 * `needsConfirm` avec le nombre de fichiers présents pour que l'utilisateur
 * valide la perte en connaissance de cause.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<{ repoUrl?: unknown; confirm?: unknown }>(req);

    if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
      return jsonError(400, "L'URL du dépôt est requise.");
    }

    const parsed = parseGithubRemote(body.repoUrl.trim());
    if (!parsed) {
      return jsonError(
        400,
        "URL non reconnue. Format attendu : https://github.com/proprietaire/depot"
      );
    }

    await ensureWorkspace();
    const fileCount = await countWorkspaceFiles();
    if (fileCount > 0 && body.confirm !== true) {
      return NextResponse.json({ needsConfirm: true, fileCount });
    }

    await clearWorkspace();

    // Clone superficiel : l'historique complet n'apporte rien au workspace
    // de l'agent et peut peser des centaines de mégaoctets.
    // Un token n'est requis que pour les dépôts privés — on le joint s'il
    // existe, et l'URL est reconstruite depuis owner/repo validés.
    const token = getGithubToken();
    await runGit(
      [
        "clone",
        "--depth",
        "1",
        `https://github.com/${parsed.owner}/${parsed.repo}.git`,
        ".",
      ],
      { cwd: WORKSPACE_ROOT, token: token ?? undefined, timeoutMs: 180_000 }
    );

    return NextResponse.json({
      message: `${parsed.owner}/${parsed.repo} cloné dans le workspace.`,
      fileCount: await countWorkspaceFiles(),
    });
  } catch (err) {
    return errorResponse(err, "api/workspace/import-github");
  }
}
