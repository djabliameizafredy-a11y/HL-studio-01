import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "./tools";

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY manquante — ajoute-la dans .env.local"
      );
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// claude-sonnet-5 par défaut — passe à claude-opus-4-8 pour les tâches les
// plus dures (gros refactors, bugs difficiles), ou remplace par Kimi
// K2.7-Code (lib/providers/kimi.ts) pour une alternative open-weight.
const AGENT_MODEL = "claude-sonnet-5";
const MAX_STEPS = 20;

const AGENT_SYSTEM_PROMPT = [
  "Tu es l'agent Code de Hight Light Studio, dans l'esprit de Claude Code.",
  "Tu as accès à un workspace de fichiers isolé et à l'exécution de",
  "commandes shell dans ce workspace. Travaille étape par étape : explore",
  "d'abord si nécessaire (list_files, read_file), explique brièvement ton",
  "plan, puis agis avec les outils. Vérifie ton travail (relis un fichier",
  "après l'avoir écrit, lance les tests si pertinent) avant de conclure.",
  "Reste concis dans tes messages texte — l'essentiel se passe dans les",
  "actions, pas dans le commentaire.",
].join(" ");

export type AgentStep =
  | { type: "text"; content: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: string }
  | { type: "done" }
  | { type: "error"; message: string };

export async function* runAgent(task: string): AsyncGenerator<AgentStep> {
  const anthropic = getClient();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await anthropic.messages.create({
        model: AGENT_MODEL,
        max_tokens: 4096,
        system: AGENT_SYSTEM_PROMPT,
        tools: toolDefinitions,
        messages,
      });

      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      ) as Anthropic.ToolUseBlock[];
      const textBlocks = response.content.filter((b) => b.type === "text") as Anthropic.TextBlock[];

      for (const t of textBlocks) {
        if (t.text.trim()) yield { type: "text", content: t.text };
      }

      if (toolUseBlocks.length === 0) {
        yield { type: "done" };
        return;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        yield { type: "tool_use", name: toolUse.name, input: toolUse.input };
        const output = await executeTool(toolUse.name, toolUse.input);
        yield { type: "tool_result", name: toolUse.name, output };
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: output,
        });
      }

      messages.push({ role: "user", content: toolResults });

      if (response.stop_reason !== "tool_use") {
        yield { type: "done" };
        return;
      }
    }

    yield {
      type: "error",
      message: `Nombre maximum d'étapes atteint (${MAX_STEPS}) — la tâche est peut-être trop large, essaie de la découper.`,
    };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}
