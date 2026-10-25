import { parseSse, postJson } from "../http";
import {
  ProviderError,
  type AiMessage,
  type AiRequest,
  type AiStopReason,
  type AiStreamEvent,
  type AiTool,
} from "../types";

// Protocole Anthropic /v1/messages. Deux différences structurantes avec
// OpenAI : le system prompt est un champ à part (pas un message), et les
// résultats d'outils reviennent dans un message `user`, pas `tool`.

const ANTHROPIC_VERSION = "2023-06-01";

function toAnthropicMessages(messages: AiMessage[]) {
  const out: Record<string, unknown>[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      // Anthropic exige que plusieurs résultats consécutifs soient groupés
      // dans un seul message user, dans l'ordre des tool_use correspondants.
      const previous = out[out.length - 1];
      if (previous?.role === "user" && Array.isArray(previous.content)) {
        (previous.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (message.role === "assistant") {
      const content: Record<string, unknown>[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input ?? {},
        });
      }
      if (content.length > 0) out.push({ role: "assistant", content });
      continue;
    }

    out.push({ role: "user", content: [{ type: "text", text: message.content }] });
  }

  return out;
}

function toAnthropicTools(tools: AiTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function mapStopReason(reason: string | null | undefined): AiStopReason {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop";
}

export async function* streamTextAnthropic(
  request: AiRequest
): AsyncGenerator<AiStreamEvent> {
  const response = await postJson({
    provider: request.provider,
    path: "/messages",
    headers: {
      "x-api-key": request.provider.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    signal: request.signal,
    body: {
      model: request.model.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature,
      ...(request.system ? { system: request.system } : {}),
      messages: toAnthropicMessages(request.messages),
      stream: true,
      ...(request.tools?.length ? { tools: toAnthropicTools(request.tools) } : {}),
    },
  });

  // Un bloc tool_use arrive en deux temps : content_block_start donne son
  // id et son nom, puis les input_json_delta apportent les arguments par
  // fragments à concaténer avant de pouvoir les parser.
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  let stopReason: AiStopReason = "stop";

  for await (const { data } of parseSse(response)) {
    let event: any;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }

    switch (event.type) {
      case "error":
        throw new ProviderError(
          `${request.provider.label} : ${event.error?.message ?? "erreur inconnue"}`,
          undefined,
          request.provider.label
        );

      case "content_block_start":
        if (event.content_block?.type === "tool_use") {
          blocks.set(event.index, {
            id: String(event.content_block.id),
            name: String(event.content_block.name),
            json: "",
          });
        }
        break;

      case "content_block_delta": {
        if (event.delta?.type === "text_delta" && event.delta.text) {
          yield { type: "text", text: event.delta.text };
        } else if (event.delta?.type === "input_json_delta") {
          const block = blocks.get(event.index);
          if (block) block.json += event.delta.partial_json ?? "";
        }
        break;
      }

      case "content_block_stop": {
        const block = blocks.get(event.index);
        if (block) {
          blocks.delete(event.index);
          let input: unknown = {};
          try {
            input = block.json ? JSON.parse(block.json) : {};
          } catch {
            input = { _rawArguments: block.json };
          }
          yield { type: "tool_call", call: { id: block.id, name: block.name, input } };
          stopReason = "tool_calls";
        }
        break;
      }

      case "message_delta":
        if (event.delta?.stop_reason) {
          stopReason = mapStopReason(event.delta.stop_reason);
        }
        break;
    }
  }

  yield { type: "done", stopReason };
}
