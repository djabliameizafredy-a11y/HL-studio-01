import { streamText } from "@/lib/ai";
import type { AiMessage, AiTool, AiToolCall } from "@/lib/ai/types";
import { resolveModelForMode, type ResolvedModel } from "@/lib/config/store";
import { toolDefinitions, executeTool } from "./tools";
import { loadProjectMemory } from "./projectMemory";
import { parseSkillCommand, loadSkill, listSkills } from "./skills";
import { executeHooks } from "./hooks";
import {
  getMcpTools,
  executeMcpTool,
  connectMcpServers,
  disconnectMcpServers,
} from "./mcpClient";

/** Nombre d'allers-retours modèle/outils avant d'abandonner une tâche. */
const MAX_STEPS = 20;

/** Délai laissé à l'utilisateur pour répondre à une demande de confirmation. */
const CONFIRMATION_TIMEOUT_MS = 300_000;

const AGENT_SYSTEM_PROMPT = [
  "Tu es l'agent Code de HL Studio, dans l'esprit de Claude Code.",
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
  | { type: "pending_confirmation"; toolCallId: string; name: string; input: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  sessionId: string;
  timeoutId: NodeJS.Timeout;
}

export const pendingConfirmations = new Map<string, PendingConfirmation>();

// Outils qui exécutent du code ou agissent hors des fichiers du workspace :
// l'utilisateur doit approuver chaque appel, sauf s'il a activé
// l'auto-approbation pour la session. Les outils MCP, eux, demandent
// toujours une confirmation — ils touchent des services externes.
export const CONFIRM_TOOLS = new Set([
  "run_command",
  "git_create_branch",
  "git_create_pr",
  "browser",
]);

export const autoApproveSessions = new Set<string>();

/** Outils interdits aux sous-agents : ils travaillent en lecture seule. */
const READ_ONLY_FORBIDDEN = new Set([
  "write_file",
  "run_command",
  "git_create_branch",
  "git_create_pr",
  "browser",
]);

/**
 * Attend la décision de l'utilisateur pour un appel d'outil.
 *
 * Le timeout est indispensable : sans lui, un onglet fermé laisserait la
 * promesse — et toute la session agent — en suspens indéfiniment, avec la
 * fuite mémoire correspondante dans `pendingConfirmations`.
 */
export function awaitConfirmation(
  toolCallId: string,
  sessionId: string,
  timeoutMs: number = CONFIRMATION_TIMEOUT_MS
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeoutId = setTimeout(() => {
      if (pendingConfirmations.delete(toolCallId)) resolve(false);
    }, timeoutMs);

    pendingConfirmations.set(toolCallId, { resolve, sessionId, timeoutId });
  });
}

function clearConfirmation(toolCallId: string): void {
  const pending = pendingConfirmations.get(toolCallId);
  if (pending) {
    clearTimeout(pending.timeoutId);
    pendingConfirmations.delete(toolCallId);
  }
}

export type ConfirmationOutcome = "resolved" | "not_found" | "wrong_session";

/**
 * Applique la décision de l'utilisateur à une demande en attente.
 *
 * La demande est retirée de la table AVANT d'être résolue : une réponse
 * rejouée (double-clic, onglet dupliqué) donne alors "not_found" au lieu
 * d'un faux succès, et le timer est libéré tout de suite plutôt que cinq
 * minutes plus tard.
 *
 * `sessionId` est vérifié ici et nulle part ailleurs : c'est ce qui
 * empêche une session d'approuver l'action d'une autre.
 */
export function resolveConfirmation(
  toolCallId: string,
  sessionId: string,
  approved: boolean
): ConfirmationOutcome {
  const pending = pendingConfirmations.get(toolCallId);
  if (!pending) return "not_found";
  if (pending.sessionId !== sessionId) return "wrong_session";

  clearTimeout(pending.timeoutId);
  pendingConfirmations.delete(toolCallId);
  pending.resolve(approved);
  return "resolved";
}

async function buildSystemPrompt(customSystemPrompt?: string): Promise<string> {
  const base = customSystemPrompt ?? AGENT_SYSTEM_PROMPT;
  const projectRules = await loadProjectMemory();
  return projectRules
    ? `${base}\n\n--- Règles du projet (HL.md) ---\n${projectRules}`
    : base;
}

/**
 * Boucle d'agent interne, utilisée directement par le coordinateur de
 * sous-agents parallèles. `customSystemPrompt` permet des rôles différents
 * par sous-agent ; sa présence déclenche aussi le mode lecture seule.
 */
export async function* runSingleAgent(
  task: string,
  sessionId: string,
  customSystemPrompt?: string,
  resolvedModel?: ResolvedModel
): AsyncGenerator<AgentStep> {
  try {
    // Le modèle vient du registre : le mode Code n'accepte qu'un modèle
    // déclaré capable d'appeler des outils (validé par resolveModelForMode).
    const { provider, model } = resolvedModel ?? resolveModelForMode("code");
    const system = await buildSystemPrompt(customSystemPrompt);

    const mcpTools = await getMcpTools();
    const allTools: AiTool[] = [...toolDefinitions, ...mcpTools];
    const tools = customSystemPrompt
      ? allTools.filter(
          (tool) => !READ_ONLY_FORBIDDEN.has(tool.name) && !tool.name.startsWith("mcp__")
        )
      : allTools;

    const messages: AiMessage[] = [{ role: "user", content: task }];

    for (let step = 0; step < MAX_STEPS; step++) {
      let assistantText = "";
      const toolCalls: AiToolCall[] = [];

      for await (const event of streamText({
        provider,
        model,
        system,
        messages,
        tools,
        maxTokens: 4096,
      })) {
        if (event.type === "text") assistantText += event.text;
        else if (event.type === "tool_call") toolCalls.push(event.call);
      }

      if (assistantText.trim()) {
        yield { type: "text", content: assistantText };
      }

      if (toolCalls.length === 0) {
        yield { type: "done" };
        return;
      }

      messages.push({ role: "assistant", content: assistantText, toolCalls });

      for (const call of toolCalls) {
        const isMcp = call.name.startsWith("mcp__");
        const needsConfirmation =
          isMcp || (CONFIRM_TOOLS.has(call.name) && !autoApproveSessions.has(sessionId));

        if (needsConfirmation) {
          yield {
            type: "pending_confirmation",
            toolCallId: call.id,
            name: call.name,
            input: call.input,
          };

          const approved = await awaitConfirmation(call.id, sessionId);
          clearConfirmation(call.id);

          if (!approved) {
            const output =
              "⚠️ Action non exécutée : l'utilisateur l'a refusée (ou le délai de 5 minutes a expiré).";
            yield { type: "tool_result", name: call.name, output };
            messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: output,
            });
            continue;
          }
        }

        yield { type: "tool_use", name: call.name, input: call.input };

        let output: string;
        if (isMcp) {
          const [, serverName, ...toolNameParts] = call.name.split("__");
          output = await executeMcpTool(serverName, toolNameParts.join("__"), call.input);
        } else {
          output = await executeTool(call.name, call.input);
        }

        yield { type: "tool_result", name: call.name, output };
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: output,
        });
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
 * Point d'entrée principal de l'agent, utilisé par /api/agent.
 * Gère les skills (/commande), les hooks de session, et délègue la boucle
 * à runSingleAgent.
 */
export async function* runAgent(
  task: string,
  sessionId: string,
  modelId?: string
): AsyncGenerator<AgentStep> {
  await connectMcpServers();

  // Hook session_start — une erreur est signalée mais ne bloque jamais.
  try {
    for (const result of await executeHooks("session_start")) {
      if (!result.success) {
        yield {
          type: "text",
          content: `⚠️ Hook session_start a échoué (${result.command}) : ${result.output}`,
        };
      }
    }
  } catch {
    // Ne jamais empêcher le démarrage à cause d'un hook
  }

  try {
    const skillCommand = parseSkillCommand(task);
    let effectiveTask = task;

    if (skillCommand) {
      const skillContent = await loadSkill(skillCommand.commandName);
      if (!skillContent) {
        const available = await listSkills();
        yield {
          type: "text",
          content: `⚠️ Skill "/${skillCommand.commandName}" introuvable. Skills disponibles : ${
            available.length > 0 ? available.map((name) => `/${name}`).join(", ") : "(aucune)"
          }`,
        };
        yield { type: "done" };
        return;
      }
      effectiveTask = `Instructions de la skill "${skillCommand.commandName}":\n${skillContent}\n\nContexte utilisateur : ${
        skillCommand.args || "(aucun argument)"
      }`;
    }

    yield* runSingleAgent(
      effectiveTask,
      sessionId,
      undefined,
      resolveModelForMode("code", modelId ?? null)
    );
  } finally {
    await disconnectMcpServers();

    // Les confirmations encore en attente appartenaient à cette session :
    // les laisser en place ferait fuir des timers et des promesses.
    for (const [toolCallId, pending] of pendingConfirmations) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeoutId);
        pending.resolve(false);
        pendingConfirmations.delete(toolCallId);
      }
    }

    try {
      await executeHooks("session_end");
    } catch {
      // Ne jamais faire planter la fin de session
    }
  }
}
