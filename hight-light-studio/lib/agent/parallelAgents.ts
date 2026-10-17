import Anthropic from "@anthropic-ai/sdk";
import { AgentStep, runSingleAgent } from "./agentLoop";
import { connectMcpServers, disconnectMcpServers } from "./mcpClient";

// ⚠️ SÉCURITÉ — Les sous-agents parallèles multiplient les actions
// simultanées dans le workspace. Chaque sous-agent reste confiné au même
// sandbox (workspace/) mais ils ne peuvent pas voir les actions des
// autres en temps réel. Ne JAMAIS exposer sans authentification.

const PARALLEL_TIMEOUT_MS = 120_000; // 2 minutes max pour l'ensemble
const MAX_SUBAGENTS = 3;

export interface SubAgentConfig {
  /** Rôle affiché (ex: "Agent Sécurité", "Agent Tests") */
  role: string;
  /** System prompt spécialisé pour ce sous-agent */
  systemPrompt: string;
}

interface SubAgentResult {
  role: string;
  steps: AgentStep[];
  /** Texte extrait des étapes "text" pour la synthèse */
  summary: string;
  /** Si le sous-agent a été interrompu par le timeout */
  timedOut: boolean;
}

/**
 * Collecte toutes les étapes d'un sous-agent en une liste.
 * Applique un timeout par sous-agent = PARALLEL_TIMEOUT_MS.
 */
async function collectSubAgentResults(
  task: string,
  sessionId: string,
  config: SubAgentConfig
): Promise<SubAgentResult> {
  const steps: AgentStep[] = [];
  const textParts: string[] = [];

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout sous-agent")), PARALLEL_TIMEOUT_MS)
    );

    const runPromise = (async () => {
      for await (const step of runSingleAgent(task, sessionId, config.systemPrompt)) {
        steps.push(step);
        if (step.type === "text") {
          textParts.push(step.content);
        }
      }
    })();

    await Promise.race([runPromise, timeoutPromise]);

    return {
      role: config.role,
      steps,
      summary: textParts.join("\n"),
      timedOut: false,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.message === "Timeout sous-agent";

    if (!isTimeout) {
      steps.push({
        type: "error",
        message: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }

    return {
      role: config.role,
      steps,
      summary:
        textParts.join("\n") ||
        (isTimeout
          ? "(timeout — résultats partiels)"
          : "(erreur — pas de résultat)"),
      timedOut: isTimeout,
    };
  }
}

/**
 * Lance plusieurs sous-agents en parallèle, chacun avec un rôle et un
 * prompt différent, puis fusionne leurs résultats en une synthèse unique.
 *
 * @param task - La tâche originale de l'utilisateur
 * @param agents - Tableau de 2-3 configurations de sous-agents
 *
 * Flux :
 * 1. Lancer tous les sous-agents en parallèle (Promise.allSettled)
 * 2. Collecter les résultats (ou les résultats partiels en cas de timeout)
 * 3. Appeler le modèle une dernière fois pour synthétiser les sorties
 *    en une réponse unique et cohérente
 */
export async function* runParallelAgents(
  task: string,
  sessionId: string,
  agents: SubAgentConfig[]
): AsyncGenerator<AgentStep> {
  // Connexion MCP (on le fait ici aussi car cette fonction est appelée comme point d'entrée alternatif)
  await connectMcpServers();

  try {
    if (agents.length === 0) {
      yield { type: "error", message: "Aucun sous-agent configuré." };
      return;
    }

    if (agents.length > MAX_SUBAGENTS) {
      yield {
        type: "error",
        message: `Maximum ${MAX_SUBAGENTS} sous-agents autorisés (reçu : ${agents.length}).`,
      };
      return;
    }

    // Signal de démarrage
    yield {
      type: "text",
      content: `🔀 Lancement de ${agents.length} sous-agent(s) en parallèle : ${agents.map((a) => a.role).join(", ")}`,
    };

    // Lancer en parallèle
    const promises = agents.map((config) =>
      collectSubAgentResults(task, sessionId, config)
    );

    const settledResults = await Promise.allSettled(promises);

    const results: SubAgentResult[] = [];
    for (const settled of settledResults) {
      if (settled.status === "fulfilled") {
        results.push(settled.value);
      } else {
        results.push({
          role: "Sous-agent inconnu",
          steps: [],
          summary: `Erreur : ${settled.reason}`,
          timedOut: false,
        });
      }
    }

    // Émettre les résultats individuels de chaque sous-agent
    for (const result of results) {
      const statusIcon = result.timedOut ? "⏱️" : "✓";
      yield {
        type: "text",
        content: `\n--- ${statusIcon} Résultat de ${result.role} ---\n${result.summary || "(aucune sortie texte)"}`,
      };
    }

    // Synthèse finale via le modèle
    yield { type: "text", content: "\n🧩 Synthèse en cours..." };

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY manquante pour la synthèse.");
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const synthesisInput = results
      .map(
        (r) =>
          `## ${r.role}${r.timedOut ? " (timeout — résultats partiels)" : ""}\n${r.summary}`
      )
      .join("\n\n---\n\n");

    const synthesisResponse = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: [
        "Tu es le coordinateur de Hight Light Studio.",
        "Tu reçois les résultats de plusieurs sous-agents spécialisés qui",
        "ont travaillé en parallèle sur la même tâche. Ton rôle est de",
        "produire une synthèse unique, structurée et actionnable :",
        "- Résume les points clés de chaque sous-agent",
        "- Identifie les contradictions ou redondances",
        "- Propose un plan d'action consolidé",
        "- Signale si un sous-agent a timeout (résultats incomplets)",
        "Sois concis et structuré.",
      ].join(" "),
      messages: [
        {
          role: "user",
          content: `Tâche originale : ${task}\n\nRésultats des sous-agents :\n\n${synthesisInput}`,
        },
      ],
    });

    const synthesisText = synthesisResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    yield {
      type: "text",
      content: `\n📋 **Synthèse finale**\n\n${synthesisText}`,
    };
    yield { type: "done" };
  } catch (err) {
    yield {
      type: "error",
      message: `Erreur lors de la synthèse ou de l'exécution parallèle : ${err instanceof Error ? err.message : "Erreur inconnue"}`,
    };
  } finally {
    await disconnectMcpServers();
  }
}
