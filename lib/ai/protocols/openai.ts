import { parseSse, postJson } from "../http";
import {
  ProviderError,
  type AiMessage,
  type AiRequest,
  type AiStopReason,
  type AiStreamEvent,
  type AiTool,
  type GeneratedImage,
} from "../types";

// Protocole OpenAI /v1/chat/completions. Couvre aussi Kimi, GLM, Groq,
// Together, OpenRouter, Mistral, Ollama, LM Studio et tout service qui
// annonce une « compatibilité OpenAI ».

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

function toOpenAiMessages(system: string | undefined, messages: AiMessage[]) {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      out.push({
        role: "assistant",
        // L'API refuse un content vide accompagné de tool_calls chez
        // certains fournisseurs : on met null, accepté partout.
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input ?? {}),
          },
        })),
      });
      continue;
    }
    out.push({ role: message.role, content: message.content });
  }
  return out;
}

function toOpenAiTools(tools: AiTool[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function mapStopReason(finishReason: string | null | undefined): AiStopReason {
  if (finishReason === "tool_calls" || finishReason === "function_call") return "tool_calls";
  if (finishReason === "length") return "length";
  return "stop";
}

export async function* streamTextOpenAi(request: AiRequest): AsyncGenerator<AiStreamEvent> {
  const response = await postJson({
    provider: request.provider,
    path: "/chat/completions",
    headers: { Authorization: `Bearer ${request.provider.apiKey}` },
    signal: request.signal,
    body: {
      model: request.model.model,
      messages: toOpenAiMessages(request.system, request.messages),
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature,
      stream: true,
      ...(request.tools?.length ? { tools: toOpenAiTools(request.tools) } : {}),
    },
  });

  // Les fragments d'appels d'outils arrivent découpés : le nom dans un
  // chunk, les arguments JSON en plusieurs morceaux. On accumule par index
  // puis on émet l'appel complet à la fin du flux.
  const pending = new Map<number, { id: string; name: string; args: string }>();
  let stopReason: AiStopReason = "stop";

  for await (const { data } of parseSse(response)) {
    if (data === "[DONE]") break;

    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue; // commentaire de keep-alive ou fragment non JSON
    }

    if (chunk.error) {
      throw new ProviderError(
        `${request.provider.label} : ${chunk.error.message ?? "erreur inconnue"}`,
        undefined,
        request.provider.label
      );
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    const text: string | undefined = choice.delta?.content;
    if (text) yield { type: "text", text };

    const deltaCalls: (OpenAiToolCall & { index?: number })[] =
      choice.delta?.tool_calls ?? [];
    deltaCalls.forEach((call, position) => {
      const index = call.index ?? position;
      const slot = pending.get(index) ?? { id: "", name: "", args: "" };
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.name = call.function.name;
      if (call.function?.arguments) slot.args += call.function.arguments;
      pending.set(index, slot);
    });

    if (choice.finish_reason) stopReason = mapStopReason(choice.finish_reason);
  }

  for (const [index, slot] of pending) {
    if (!slot.name) continue;
    let input: unknown = {};
    try {
      input = slot.args ? JSON.parse(slot.args) : {};
    } catch {
      // Un modèle produit parfois du JSON invalide. On transmet la chaîne
      // brute pour que l'outil puisse renvoyer une erreur explicite plutôt
      // que de faire échouer toute la session.
      input = { _rawArguments: slot.args };
    }
    yield {
      type: "tool_call",
      call: { id: slot.id || `call_${index}`, name: slot.name, input },
    };
    stopReason = "tool_calls";
  }

  yield { type: "done", stopReason };
}

export async function generateImageOpenAi(
  request: Omit<AiRequest, "messages"> & { prompt: string }
): Promise<GeneratedImage> {
  const response = await postJson({
    provider: request.provider,
    path: "/images/generations",
    headers: { Authorization: `Bearer ${request.provider.apiKey}` },
    signal: request.signal,
    body: {
      model: request.model.model,
      prompt: request.prompt,
      n: 1,
      response_format: "b64_json",
    },
  });

  const payload: any = await response.json();
  const first = payload.data?.[0];

  if (first?.b64_json) {
    return { image: `data:image/png;base64,${first.b64_json}` };
  }
  if (first?.url) {
    return { image: String(first.url) };
  }
  throw new ProviderError(
    `${request.provider.label} n'a renvoyé aucune image exploitable.`,
    undefined,
    request.provider.label
  );
}
