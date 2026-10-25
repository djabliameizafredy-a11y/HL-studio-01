import { NextRequest, NextResponse } from "next/server";
import {
  readPublicConfig,
  setAssignment,
  setAssistantModel,
  setGithubToken,
  setPreferences,
} from "@/lib/config/store";
import { WORKSPACE_MODES, type WorkspaceMode } from "@/lib/types";
import { errorResponse, jsonError, readJsonBody } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Configuration complète, sans aucune clé d'API. */
export async function GET() {
  try {
    return NextResponse.json(readPublicConfig());
  } catch (err) {
    return errorResponse(err, "api/settings");
  }
}

interface PatchBody {
  assignments?: Partial<Record<WorkspaceMode, string | null>>;
  assistantModelId?: string | null;
  githubToken?: string;
  preferences?: { theme?: string };
}

/**
 * Mise à jour partielle des réglages.
 * PATCH /api/settings
 *
 * Chaque bloc est optionnel : l'interface n'envoie que ce qui a changé.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await readJsonBody<PatchBody>(req);

    if (body.assignments) {
      for (const [mode, modelId] of Object.entries(body.assignments)) {
        if (!WORKSPACE_MODES.includes(mode as WorkspaceMode)) {
          return jsonError(400, `Mode inconnu : ${mode}`);
        }
        if (modelId !== null && typeof modelId !== "string") {
          return jsonError(400, `Identifiant de modèle invalide pour le mode ${mode}.`);
        }
        setAssignment(mode as WorkspaceMode, modelId);
      }
    }

    if (body.assistantModelId !== undefined) {
      setAssistantModel(body.assistantModelId);
    }

    if (body.githubToken !== undefined) {
      setGithubToken(body.githubToken);
    }

    if (body.preferences) {
      setPreferences(body.preferences);
    }

    return NextResponse.json(readPublicConfig());
  } catch (err) {
    return errorResponse(err, "api/settings");
  }
}
