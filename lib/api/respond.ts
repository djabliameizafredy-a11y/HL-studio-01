import { NextResponse } from "next/server";
import { ConfigValidationError } from "@/lib/config/store";
import { ProviderError } from "@/lib/ai/types";
import { GitError } from "@/lib/workspace/github";

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Traduit une exception en réponse HTTP.
 *
 * Les erreurs de validation et les erreurs de fournisseur portent un
 * message écrit pour l'utilisateur et peuvent être renvoyées telles quelles.
 * Tout le reste est un bug de notre côté : on logue la trace et on renvoie
 * un message générique, pour ne pas divulguer de chemins disque ni de
 * fragments de configuration au navigateur.
 */
export function errorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof ConfigValidationError) {
    return jsonError(400, err.message);
  }
  if (err instanceof ProviderError) {
    return jsonError(err.status === 401 || err.status === 403 ? 400 : 502, err.message);
  }
  if (err instanceof GitError) {
    // Le message de Git est déjà débarrassé du token et dit précisément ce
    // qui bloque (dépôt inconnu, droits insuffisants, push rejeté).
    return jsonError(400, err.message);
  }

  console.error(`[${context}]`, err);
  return jsonError(
    500,
    "Une erreur interne est survenue. Consulte la sortie du terminal où tourne HL Studio pour le détail."
  );
}

/** Lecture du corps JSON avec un message clair si le corps est absent. */
export async function readJsonBody<T = Record<string, unknown>>(
  req: Request
): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ConfigValidationError("Corps de requête JSON invalide ou absent.");
  }
}
