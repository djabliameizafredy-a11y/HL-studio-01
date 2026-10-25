import { streamText } from "./index";
import { ProviderError, type AiTool } from "./types";
import type { ModelRecord, ProviderRecord } from "@/lib/types";

export interface ModelTestResult {
  ok: boolean;
  message: string;
  /** Détail par vérification, pour afficher une liste dans les Réglages. */
  checks: { name: string; ok: boolean; detail: string }[];
}

// Outil volontairement trivial : on ne teste pas la logique du modèle, on
// vérifie seulement que l'API accepte le champ `tools` et renvoie un appel
// correctement formé. Sans ça, le Mode Agent échouerait à la première tâche.
const PING_TOOL: AiTool = {
  name: "hl_ping",
  description:
    "Outil de vérification. Appelle-le une fois avec le texte exact demandé.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "Le texte à renvoyer." },
    },
    required: ["message"],
  },
};

const TIMEOUT_MS = 30_000;

export async function testModel(
  provider: ProviderRecord,
  model: ModelRecord
): Promise<ModelTestResult> {
  const checks: ModelTestResult["checks"] = [];

  const textCheck = await runTextCheck(provider, model);
  checks.push(textCheck);

  // Le Mode Agent n'est utilisable qu'avec un modèle capable d'appeler des
  // outils : on ne le vérifie donc que si l'utilisateur l'a déclaré.
  if (model.supportsTools) {
    checks.push(await runToolCheck(provider, model));
  }

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    message: ok
      ? `"${model.label}" répond correctement via ${provider.label}.`
      : checks.find((check) => !check.ok)!.detail,
    checks,
  };
}

async function runTextCheck(provider: ProviderRecord, model: ModelRecord) {
  try {
    let text = "";
    for await (const event of streamText({
      provider,
      model,
      system: "Réponds uniquement par le mot OK.",
      messages: [{ role: "user", content: "Réponds OK." }],
      maxTokens: 32,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })) {
      if (event.type === "text") text += event.text;
    }

    if (!text.trim()) {
      return {
        name: "Réponse texte",
        ok: false,
        detail:
          "Le modèle a accepté la requête mais n'a renvoyé aucun texte. Vérifie le nom exact du modèle.",
      };
    }
    return {
      name: "Réponse texte",
      ok: true,
      detail: `Réponse reçue : "${text.trim().slice(0, 60)}"`,
    };
  } catch (err) {
    return { name: "Réponse texte", ok: false, detail: describe(err) };
  }
}

async function runToolCheck(provider: ProviderRecord, model: ModelRecord) {
  try {
    let called = false;
    for await (const event of streamText({
      provider,
      model,
      system: "Tu dois obligatoirement utiliser l'outil hl_ping pour répondre.",
      messages: [
        { role: "user", content: 'Appelle hl_ping avec le message "pong".' },
      ],
      tools: [PING_TOOL],
      maxTokens: 256,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })) {
      if (event.type === "tool_call" && event.call.name === PING_TOOL.name) {
        called = true;
      }
    }

    return called
      ? { name: "Appel d'outil", ok: true, detail: "Le modèle a bien appelé l'outil de test." }
      : {
          name: "Appel d'outil",
          ok: false,
          detail:
            "Le modèle n'a appelé aucun outil. Il n'est probablement pas utilisable pour le Mode Agent : décoche « Sait appeler des outils ».",
        };
  } catch (err) {
    return { name: "Appel d'outil", ok: false, detail: describe(err) };
  }
}

function describe(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  if (err instanceof Error && err.name === "TimeoutError") {
    return `Aucune réponse en ${TIMEOUT_MS / 1000} s.`;
  }
  return err instanceof Error ? err.message : "Erreur inconnue.";
}
