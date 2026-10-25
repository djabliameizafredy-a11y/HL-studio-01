import { NextRequest } from "next/server";
import { streamText, generateImage, generateVideo } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import { ConfigValidationError, resolveModelForMode } from "@/lib/config/store";
import {
  addMedia,
  addMessage,
  conversationExists,
  createConversation,
} from "@/lib/db/conversations";
import { saveDataUri } from "@/lib/media/store";
import { errorResponse, jsonError, readJsonBody } from "@/lib/api/respond";
import { WORKSPACE_MODES, type ChatMessage, type WorkspaceMode } from "@/lib/types";

export const runtime = "nodejs";

/** Garde-fou mémoire : au-delà, la requête est tronquée côté fournisseur de toute façon. */
const MAX_MESSAGES = 200;

interface ChatBody {
  messages?: unknown;
  mode?: unknown;
  modelId?: unknown;
  conversationId?: unknown;
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigValidationError("Le champ 'messages' est requis.");
  }
  if (value.length > MAX_MESSAGES) {
    throw new ConfigValidationError(
      `Conversation trop longue (${value.length} messages). Démarre une nouvelle conversation.`
    );
  }
  return value.map((item, index) => {
    const role = (item as ChatMessage)?.role;
    const content = (item as ChatMessage)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      throw new ConfigValidationError(`Message ${index} mal formé.`);
    }
    return { role, content };
  });
}

/** Encode un évènement au format SSE attendu par les panneaux du client. */
function sse(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(req: NextRequest) {
  let mode: WorkspaceMode;
  let messages: ChatMessage[];
  let conversationId: string;
  let resolved: ReturnType<typeof resolveModelForMode>;

  // Phase 1 — tout ce qui peut échouer de façon « propre » est fait avant
  // d'ouvrir le flux : une fois les en-têtes SSE envoyés, on ne peut plus
  // renvoyer de code d'erreur HTTP exploitable par le client.
  try {
    const body = await readJsonBody<ChatBody>(req);

    mode = WORKSPACE_MODES.includes(body.mode as WorkspaceMode)
      ? (body.mode as WorkspaceMode)
      : "chat";
    messages = parseMessages(body.messages);
    resolved = resolveModelForMode(
      mode,
      typeof body.modelId === "string" ? body.modelId : null
    );

    conversationId =
      typeof body.conversationId === "string" && conversationExists(body.conversationId)
        ? body.conversationId
        : createConversation(mode, messages[0]?.content.slice(0, 80));

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === "user") {
      addMessage({ conversationId, role: "user", content: lastMessage.content });
    }
  } catch (err) {
    return errorResponse(err, "api/chat");
  }

  const { provider, model } = resolved;
  const modelTag = `${provider.label} / ${model.label}`;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse({ conversationId }));

      try {
        if (mode === "design") {
          await handleImage(controller, { conversationId, modelTag, resolved, messages, signal: req.signal });
        } else if (mode === "video") {
          await handleVideo(controller, { conversationId, modelTag, resolved, messages, signal: req.signal });
        } else {
          await handleText(controller, { conversationId, modelTag, resolved, messages, signal: req.signal });
        }
      } catch (err) {
        const message =
          err instanceof ProviderError || err instanceof ConfigValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Erreur inconnue";
        controller.enqueue(sse({ error: message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Sans ça, un reverse-proxy éventuel bufferise le flux et le
      // streaming perd tout son intérêt.
      "X-Accel-Buffering": "no",
    },
  });
}

interface HandlerContext {
  conversationId: string;
  modelTag: string;
  resolved: ReturnType<typeof resolveModelForMode>;
  messages: ChatMessage[];
  signal: AbortSignal;
}

async function handleText(
  controller: ReadableStreamDefaultController,
  { conversationId, modelTag, resolved, messages, signal }: HandlerContext
) {
  let full = "";

  for await (const event of streamText({
    provider: resolved.provider,
    model: resolved.model,
    messages,
    signal,
  })) {
    if (event.type === "text") {
      full += event.text;
      controller.enqueue(sse({ text: event.text }));
    }
  }

  // La réponse n'est enregistrée qu'une fois complète : un message
  // partiellement écrit en base fausserait le contexte des tours suivants.
  if (full) {
    addMessage({ conversationId, role: "assistant", content: full, modelUsed: modelTag });
  }
}

async function handleImage(
  controller: ReadableStreamDefaultController,
  { conversationId, modelTag, resolved, messages, signal }: HandlerContext
) {
  const prompt = messages[messages.length - 1].content;
  const result = await generateImage({
    provider: resolved.provider,
    model: resolved.model,
    prompt,
    signal,
  });

  const text = result.text ?? "Image générée.";
  const messageId = addMessage({
    conversationId,
    role: "assistant",
    content: text,
    modelUsed: modelTag,
  });

  // Un data URI de plusieurs mégaoctets ne doit pas transiter par
  // l'historique : on l'écrit sur disque et on ne renvoie que son URL.
  const saved = result.image.startsWith("data:") ? await saveDataUri(result.image) : null;
  const url = saved?.url ?? result.image;

  addMedia(messageId, url, "image");
  controller.enqueue(sse({ text, imageUrl: url }));
}

async function handleVideo(
  controller: ReadableStreamDefaultController,
  { conversationId, modelTag, resolved, messages, signal }: HandlerContext
) {
  const prompt = messages[messages.length - 1].content;
  const result = await generateVideo({
    provider: resolved.provider,
    model: resolved.model,
    prompt,
    signal,
  });

  if (result.status === "pending") {
    // La génération vidéo prend plusieurs minutes : on rend la main au
    // client avec l'identifiant de tâche, qu'il interroge via /api/video/status.
    const text = "Génération vidéo lancée. Le rendu peut prendre plusieurs minutes.";
    addMessage({ conversationId, role: "assistant", content: text, modelUsed: modelTag });
    controller.enqueue(sse({ text, jobId: result.jobId }));
    return;
  }

  const text = result.text ?? "Vidéo générée.";
  const messageId = addMessage({
    conversationId,
    role: "assistant",
    content: text,
    modelUsed: modelTag,
  });

  const saved = result.video?.startsWith("data:") ? await saveDataUri(result.video) : null;
  const url = saved?.url ?? result.video!;

  addMedia(messageId, url, "video");
  controller.enqueue(sse({ text, videoUrl: url }));
}

export function GET() {
  return jsonError(405, "Utilise POST sur /api/chat.");
}
