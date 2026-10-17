import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "./tools";
import { loadProjectMemory } from "./projectMemory";
import { parseSkillCommand, loadSkill, listSkills } from "./skills";
import { executeHooks } from "./hooks";

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

import { getMcpTools, executeMcpTool, connectMcpServers, disconnectMcpServers } from "./mcpClient";

export type AgentStep =
  | { type: "text"; content: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: string }
  | { type: "pending_confirmation"; toolCallId: string; name: string; input: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  sessionId: string;
  timeoutId: NodeJS.Timeout;
}

export const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * Boucle d'agent interne — utilisable directement par le coordinateur
 * de sous-agents parallèles (parallelAgents.ts). Accepte un system prompt
 * custom pour permettre des rôles différents par sous-agent.
 *
 * @param task - La tâche à accomplir
 * @param sessionId - L'identifiant de la session courante
 * @param customSystemPrompt - System prompt à utiliser (si non fourni,
 *   utilise AGENT_SYSTEM_PROMPT + mémoire projet HL.md)
 */
export async function* runSingleAgent(
  task: string,
  sessionId: string,
  customSystemPrompt?: string
): AsyncGenerator<AgentStep> {
  const anthropic = getClient();

  // Construire le system prompt : custom OU défaut + mémoire projet
  let systemPrompt: string;
  if (customSystemPrompt) {
    // Les sous-agents parallèles fournissent leur propre prompt
    const projectRules = await loadProjectMemory();
    systemPrompt = projectRules
      ? `${customSystemPrompt}\n\n--- Règles du projet (HL.md) ---\n${projectRules}`
      : customSystemPrompt;
  } else {
    const projectRules = await loadProjectMemory();
    systemPrompt = projectRules
      ? `${AGENT_SYSTEM_PROMPT}\n\n--- Règles du projet (HL.md) ---\n${projectRules}`
      : AGENT_SYSTEM_PROMPT;
  }

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task },
  ];

  try {
    // Injecter les outils MCP dynamiquement
    const mcpTools = await getMcpTools();
    const allTools = [...toolDefinitions, ...mcpTools];

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await anthropic.messages.create({
        model: AGENT_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: customSystemPrompt
          ? allTools.filter(t => !["write_file", "run_command", "git_create_branch", "git_create_pr"].includes(t.name) && !t.name.startsWith("mcp__")) // Sous-agents n'ont pas le droit aux outils modifiants ni aux outils MCP externes par sécurité (lecture seule)
          : allTools,
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
        // Exécution MCP ou interne
        if (toolUse.name.startsWith("mcp__")) {
          // MCP : On met en pause et on attend la confirmation utilisateur
          yield { 
            type: "pending_confirmation", 
            toolCallId: toolUse.id, 
            name: toolUse.name, 
            input: toolUse.input 
          };

          const approved = await new Promise<boolean>((resolve) => {
            const timeoutId = setTimeout(() => {
              if (pendingConfirmations.has(toolUse.id)) {
                pendingConfirmations.delete(toolUse.id);
                resolve(false); // Refusé par timeout
              }
            }, 300_000); // 5 minutes

            pendingConfirmations.set(toolUse.id, { resolve, sessionId, timeoutId });
          });
          
          if (pendingConfirmations.has(toolUse.id)) {
            clearTimeout(pendingConfirmations.get(toolUse.id)!.timeoutId);
            pendingConfirmations.delete(toolUse.id);
          }

          if (!approved) {
            const output = "⚠️ Outil non exécuté : L'utilisateur a refusé l'exécution de cet outil externe (ou le délai de 5 minutes a expiré).";
            yield { type: "tool_result", name: toolUse.name, output };
            toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: output });
            continue;
          }

          yield { type: "tool_use", name: toolUse.name, input: toolUse.input };
          const [, serverName, ...toolNameParts] = toolUse.name.split("__");
          const realToolName = toolNameParts.join("__");
          const output = await executeMcpTool(serverName, realToolName, toolUse.input);
          
          yield { type: "tool_result", name: toolUse.name, output };
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: output });
        } else {
          // Outil interne classique
          yield { type: "tool_use", name: toolUse.name, input: toolUse.input };
          const output = await executeTool(toolUse.name, toolUse.input);
          
          yield { type: "tool_result", name: toolUse.name, output };
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: output,
          });
        }
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

/**
 * Point d'entrée principal de l'agent — utilisé par /api/agent.
 * Gère les skills (/commande), les hooks session_start/session_end,
 * et délègue à runSingleAgent pour la boucle principale.
 */
export async function* runAgent(task: string, sessionId: string): AsyncGenerator<AgentStep> {
  // Connexion MCP
  await connectMcpServers();

  // Hook session_start — erreur logguée, jamais bloquant
  try {
    const startResults = await executeHooks("session_start");
    for (const r of startResults) {
      if (!r.success) {
        yield {
          type: "text",
          content: `⚠️ Hook session_start a échoué (${r.command}) : ${r.output}`,
        };
      }
    }
  } catch {
    // Ne jamais bloquer le démarrage à cause d'un hook
  }

  try {
    // Résolution des skills (/commande)
    const skillCmd = parseSkillCommand(task);
    let effectiveTask = task;
    if (skillCmd) {
      const skillContent = await loadSkill(skillCmd.commandName);
      if (skillContent) {
        effectiveTask = `Instructions de la skill "${skillCmd.commandName}":\n${skillContent}\n\nContexte utilisateur : ${skillCmd.args || "(aucun argument)"}`;
      } else {
        const available = await listSkills();
        yield {
          type: "text",
          content: `⚠️ Skill "/${skillCmd.commandName}" introuvable. Skills disponibles : ${available.length > 0 ? available.map((s) => "/" + s).join(", ") : "(aucune)"}`,
        };
        yield { type: "done" };
        return;
      }
    }

    // Boucle principale
    yield* runSingleAgent(effectiveTask, sessionId);
  } finally {
    // Déconnexion MCP
    await disconnectMcpServers();

    // Hook session_end — toujours exécuté, même en cas d'erreur
    try {
      await executeHooks("session_end");
    } catch {
      // Ne jamais faire planter la fin de session
    }
  }
}
