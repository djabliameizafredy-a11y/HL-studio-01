import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_ROOT, ensureWorkspace } from "@/lib/agent/sandbox";
import {
  getGithubToken,
  isValidBranchName,
  parseGithubRemote,
  runGit,
} from "@/lib/workspace/github";
import { errorResponse, jsonError, readJsonBody } from "@/lib/api/respond";
import { ConfigValidationError } from "@/lib/config/store";

export const runtime = "nodejs";

const MAX_COMMIT_MESSAGE = 500;

/** Dépôt cible : l'URL fournie, sinon le remote `origin` du workspace. */
async function resolveTargetRepo(repoUrl: string | undefined) {
  if (repoUrl) {
    const parsed = parseGithubRemote(repoUrl);
    if (!parsed) {
      throw new ConfigValidationError(
        "URL non reconnue. Format attendu : https://github.com/proprietaire/depot"
      );
    }
    return parsed;
  }

  const remote = await runGit(["remote", "get-url", "origin"], {
    cwd: WORKSPACE_ROOT,
  }).catch(() => "");

  if (!remote) {
    throw new ConfigValidationError(
      "Aucun remote 'origin' dans le workspace : indique l'URL du dépôt cible."
    );
  }

  const parsed = parseGithubRemote(remote);
  if (!parsed) {
    // Refus volontaire : pousser vers un hôte arbitraire enverrait le token
    // de l'utilisateur à ce serveur.
    throw new ConfigValidationError(
      "Le remote 'origin' n'est pas un dépôt github.com : push refusé pour ne pas envoyer le token ailleurs."
    );
  }
  return parsed;
}

/** Identité de commit à utiliser si Git n'en a aucune de configurée. */
async function commitIdentityArgs(): Promise<string[]> {
  const email = await runGit(["config", "--get", "user.email"], {
    cwd: WORKSPACE_ROOT,
  }).catch(() => "");

  return email
    ? []
    : ["-c", "user.name=HL Studio", "-c", "user.email=hlstudio@localhost"];
}

/**
 * Commit et push du workspace vers GitHub.
 * POST /api/workspace/push-github  { repoUrl?, commitMessage?, branch? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<{
      repoUrl?: unknown;
      commitMessage?: unknown;
      branch?: unknown;
    }>(req);

    const token = getGithubToken();
    if (!token) {
      return jsonError(
        400,
        "Aucun token GitHub enregistré. Ajoute-le dans les Réglages (onglet Intégrations)."
      );
    }

    const commitMessage =
      typeof body.commitMessage === "string" && body.commitMessage.trim()
        ? body.commitMessage.trim().slice(0, MAX_COMMIT_MESSAGE)
        : "chore: update from HL Studio";

    const branch = body.branch === undefined ? "main" : body.branch;
    if (!isValidBranchName(branch)) {
      return jsonError(400, "Nom de branche invalide.");
    }

    await ensureWorkspace();
    const target = await resolveTargetRepo(
      typeof body.repoUrl === "string" && body.repoUrl.trim()
        ? body.repoUrl.trim()
        : undefined
    );

    // `git init` est idempotent sur un dépôt existant : inutile de tester
    // d'abord la présence de .git.
    await runGit(["init", "--initial-branch", branch], { cwd: WORKSPACE_ROOT });
    await runGit(["add", "-A"], { cwd: WORKSPACE_ROOT });

    const status = await runGit(["status", "--porcelain"], { cwd: WORKSPACE_ROOT });
    if (status) {
      const identity = await commitIdentityArgs();
      await runGit([...identity, "commit", "-m", commitMessage], {
        cwd: WORKSPACE_ROOT,
      });
    }

    const head = await runGit(["rev-parse", "--verify", "HEAD"], {
      cwd: WORKSPACE_ROOT,
    }).catch(() => "");
    if (!head) {
      return jsonError(400, "Le workspace est vide : il n'y a rien à pousser.");
    }

    await runGit(
      [
        "push",
        `https://github.com/${target.owner}/${target.repo}.git`,
        `HEAD:refs/heads/${branch}`,
      ],
      { cwd: WORKSPACE_ROOT, token, timeoutMs: 180_000 }
    );

    return NextResponse.json({
      message: status
        ? `Poussé vers ${target.owner}/${target.repo} (branche ${branch}).`
        : `Aucune modification à committer — ${target.owner}/${target.repo} est déjà à jour.`,
    });
  } catch (err) {
    return errorResponse(err, "api/workspace/push-github");
  }
}
