import { parseSse, postJson } from "../http";
import {
  ProviderError,
  type AiMessage,
  type AiRequest,
  type AiStopReason,
  type AiStreamEvent,
  type AiTool,
  type GeneratedImage,
  type GeneratedVideo,
} from "../types";

// Protocole Google Generative Language (Gemini, Imagen, Veo).
// Particularités : le modèle fait partie du chemin, le rôle « assistant »
// s'appelle « model », et les appels d'outils n'ont pas d'identifiant —
// on en fabrique un pour rester compatible avec le format normalisé.

function toGeminiContents(messages: AiMessage[]) {
  const out: Record<string, unknown>[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.name,
              response: { result: message.content },
            },
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant") {
      const parts: Record<string, unknown>[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.input ?? {} } });
      }
      if (parts.length > 0) out.push({ role: "model", parts });
      continue;
    }

    out.push({ role: "user", parts: [{ text: message.content }] });
  }

  return out;
}

/**
 * Gemini rejette les mots-clés JSON Schema qu'il ne connaît pas
 * (`additionalProperties`, `$schema`...), alors que les schémas d'outils
 * écrits pour OpenAI ou Anthropic en contiennent couramment.
 */
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== "object") return schema;

  const ignored = new Set(["additionalProperties", "$schema", "default", "examples"]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (ignored.has(key)) continue;
    out[key] = sanitizeSchema(value);
  }
  return out;
}

function toGeminiTools(tools: AiTool[]) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: sanitizeSchema(tool.inputSchema),
      })),
    },
  ];
}

function mapStopReason(reason: string | null | undefined): AiStopReason {
  if (reason === "MAX_TOKENS") return "length";
  return "stop";
}

export async function* streamTextGemini(
  request: AiRequest
): AsyncGenerator<AiStreamEvent> {
  const response = await postJson({
    provider: request.provider,
    path: `/models/${encodeURIComponent(request.model.model)}:streamGenerateContent?alt=sse`,
    headers: { "x-goog-api-key": request.provider.apiKey },
    signal: request.signal,
    body: {
      contents: toGeminiContents(request.messages),
      ...(request.system
        ? { systemInstruction: { parts: [{ text: request.system }] } }
        : {}),
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4096,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      },
      ...(request.tools?.length ? { tools: toGeminiTools(request.tools) } : {}),
    },
  });

  let stopReason: AiStopReason = "stop";
  let callIndex = 0;

  for await (const { data } of parseSse(response)) {
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }

    if (chunk.error) {
      throw new ProviderError(
        `${request.provider.label} : ${chunk.error.message ?? "erreur inconnue"}`,
        undefined,
        request.provider.label
      );
    }

    const candidate = chunk.candidates?.[0];
    if (!candidate) continue;

    for (const part of candidate.content?.parts ?? []) {
      if (part.text) yield { type: "text", text: part.text };
      if (part.functionCall) {
        yield {
          type: "tool_call",
          call: {
            id: `gemini_call_${callIndex++}`,
            name: String(part.functionCall.name),
            input: part.functionCall.args ?? {},
          },
        };
        stopReason = "tool_calls";
      }
    }

    if (candidate.finishReason && stopReason !== "tool_calls") {
      stopReason = mapStopReason(candidate.finishReason);
    }
  }

  yield { type: "done", stopReason };
}

export async function generateImageGemini(
  request: Omit<AiRequest, "messages"> & { prompt: string }
): Promise<GeneratedImage> {
  const response = await postJson({
    provider: request.provider,
    path: `/models/${encodeURIComponent(request.model.model)}:generateContent`,
    headers: { "x-goog-api-key": request.provider.apiKey },
    signal: request.signal,
    body: {
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    },
  });

  const payload: any = await response.json();
  const parts: any[] = payload.candidates?.[0]?.content?.parts ?? [];

  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart) {
    // Un refus du filtre de contenu arrive sous cette forme : du texte sans
    // image. Le remonter tel quel est plus utile qu'un « aucune image ».
    const text = parts.map((part) => part.text).filter(Boolean).join("\n");
    throw new ProviderError(
      text
        ? `${request.provider.label} n'a pas généré d'image : ${text}`
        : `${request.provider.label} n'a renvoyé aucune image. Vérifie que "${request.model.model}" est bien un modèle de génération d'images.`,
      undefined,
      request.provider.label
    );
  }

  const mime = imagePart.inlineData.mimeType ?? "image/png";
  return {
    image: `data:${mime};base64,${imagePart.inlineData.data}`,
    text: parts.map((part) => part.text).filter(Boolean).join("\n") || undefined,
  };
}

export async function generateVideoGemini(
  request: Omit<AiRequest, "messages"> & { prompt: string }
): Promise<GeneratedVideo> {
  // Les modèles vidéo de Google sont asynchrones : l'appel démarre une
  // opération longue et renvoie son nom, qu'il faut ensuite interroger.
  const response = await postJson({
    provider: request.provider,
    path: `/models/${encodeURIComponent(request.model.model)}:predictLongRunning`,
    headers: { "x-goog-api-key": request.provider.apiKey },
    signal: request.signal,
    body: { instances: [{ prompt: request.prompt }] },
  });

  const payload: any = await response.json();
  if (!payload.name) {
    throw new ProviderError(
      `${request.provider.label} n'a pas démarré de tâche vidéo.`,
      undefined,
      request.provider.label
    );
  }
  return { jobId: String(payload.name), status: "pending" };
}

/** Interroge une tâche vidéo Gemini déjà lancée. */
export async function pollVideoGemini(
  provider: AiRequest["provider"],
  jobId: string,
  signal?: AbortSignal
): Promise<GeneratedVideo> {
  // Le nom d'opération vient du fournisseur, mais il finit dans une URL :
  // on refuse tout ce qui pourrait sortir du chemin attendu.
  if (!/^[A-Za-z0-9/_.-]+$/.test(jobId) || jobId.includes("..")) {
    throw new ProviderError("Identifiant de tâche vidéo invalide.");
  }

  const response = await fetch(`${provider.baseUrl}/${jobId}`, {
    headers: { "x-goog-api-key": provider.apiKey },
    signal,
  });

  if (!response.ok) {
    throw new ProviderError(
      `Impossible de lire l'état de la tâche vidéo (${response.status}).`,
      response.status,
      provider.label
    );
  }

  const payload: any = await response.json();
  if (!payload.done) return { jobId, status: "pending" };

  if (payload.error) {
    throw new ProviderError(
      `La génération vidéo a échoué : ${payload.error.message ?? "raison inconnue"}`,
      undefined,
      provider.label
    );
  }

  const video =
    payload.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
    payload.response?.predictions?.[0]?.videoUri;

  if (!video) {
    throw new ProviderError(
      "La tâche vidéo est terminée mais ne contient aucune vidéo.",
      undefined,
      provider.label
    );
  }

  return { jobId, status: "done", video: String(video) };
}
