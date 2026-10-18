"use client";

import { useRef, useState } from "react";
import WorkspaceToolbar from "@/components/WorkspaceToolbar";

type AgentStep =
  | { type: "text"; content: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: string }
  | { type: "pending_confirmation"; toolCallId: string; name: string; input: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export default function AgentPanel() {
  const [task, setTask] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [running, setRunning] = useState(false);
  // Auto-approbation des COMMANDES pour la prochaine tâche (les outils MCP
  // externes demandent toujours une confirmation).
  const [autoApprove, setAutoApprove] = useState(false);
  // Décision prise pour chaque demande de confirmation (par toolCallId).
  const [decisions, setDecisions] = useState<Record<string, "approved" | "denied">>({});
  const sessionIdRef = useRef<string | null>(null);

  async function answerConfirmation(toolCallId: string, approved: boolean) {
    setDecisions((d) => ({ ...d, [toolCallId]: approved ? "approved" : "denied" }));
    try {
      await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, sessionId: sessionIdRef.current, approved }),
      });
    } catch {
      // Si l'envoi échoue, la demande expirera côté serveur (refus après 5 min).
    }
  }

  async function runTask() {
    if (!task.trim() || running) return;
    setSteps([]);
    setDecisions({});
    sessionIdRef.current = null;
    setRunning(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, autoApprove }),
      });

      if (!res.body) throw new Error("Pas de flux de réponse du serveur.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = JSON.parse(line);
          if (parsed.type === "session_id") {
            sessionIdRef.current = parsed.sessionId;
            continue; // événement technique, pas affiché
          }
          setSteps((prev) => [...prev, parsed]);
        }
      }
    } catch (err) {
      setSteps((prev) => [
        ...prev,
        {
          type: "error",
          message: err instanceof Error ? err.message : "Erreur inconnue",
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col liquid-glass-card rounded-xl p-4 overflow-hidden">
      <h2 className="mb-1 font-display text-2xl text-studio-text opacity-70">
        Mode Agent — Code &amp; architecture
      </h2>
      <p className="mb-3 text-sm text-studio-muted">
        L'agent lit/écrit des fichiers et exécute des commandes dans un
        workspace isolé (dossier <code>workspace/</code>). Voir README pour
        les précautions de sécurité avant tout déploiement public.
      </p>

      {/* Barre d'outils Import */}
      <div className="mb-3 pb-3 border-b border-studio-border">
        <WorkspaceToolbar />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-2 mb-4">
        {steps.length === 0 && (
          <p className="text-sm text-studio-muted">
            Ex : "Crée un fichier utils.ts avec une fonction slugify, puis
            teste-la avec un exemple."
          </p>
        )}

        {steps.map((step, i) => {
          if (step.type === "text") {
            return (
              <p key={i} className="text-sm">
                {step.content}
              </p>
            );
          }
          if (step.type === "tool_use") {
            return (
              <p key={i} className="font-mono text-xs text-studio-accent">
                → {step.name}({JSON.stringify(step.input)})
              </p>
            );
          }
          if (step.type === "tool_result") {
            return (
              <pre
                key={i}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-studio-bg p-2 font-mono text-xs text-studio-muted"
              >
                {step.output}
              </pre>
            );
          }
          if (step.type === "pending_confirmation") {
            const decision = decisions[step.toolCallId];
            return (
              <div
                key={i}
                className="rounded-lg border border-amber-400/60 bg-amber-400/10 p-3 text-sm"
              >
                <p className="mb-1 font-medium text-studio-text">
                  L'agent demande l'autorisation d'exécuter : <code>{step.name}</code>
                </p>
                <pre className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-studio-bg p-2 font-mono text-xs text-studio-muted">
                  {JSON.stringify(step.input, null, 2)}
                </pre>
                {decision ? (
                  <p className="text-xs text-studio-muted">
                    {decision === "approved" ? "✓ Autorisé" : "✗ Refusé"}
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => answerConfirmation(step.toolCallId, true)}
                      className="rounded-md bg-studio-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-studio-accentDark"
                    >
                      Autoriser
                    </button>
                    <button
                      onClick={() => answerConfirmation(step.toolCallId, false)}
                      className="rounded-md border border-studio-border px-4 py-1.5 text-xs text-studio-text hover:bg-studio-bg"
                    >
                      Refuser
                    </button>
                  </div>
                )}
              </div>
            );
          }
          if (step.type === "error") {
            return (
              <p key={i} className="text-sm text-red-400">
                Erreur : {step.message}
              </p>
            );
          }
          if (step.type === "done") {
            return (
              <p key={i} className="text-sm text-studio-accentDark">
                ✓ Terminé
              </p>
            );
          }
          return null;
        })}

        {running && (
          <p className="text-sm text-studio-muted">L'agent travaille...</p>
        )}
      </div>

      <label className="mb-2 flex items-center gap-2 text-xs text-studio-muted">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)}
          disabled={running}
        />
        Exécuter les commandes sans me demander (cette tâche uniquement).
        Les outils externes (MCP) demandent toujours ton accord.
      </label>

      <div className="mt-auto flex gap-2">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runTask()}
          placeholder="Décris la tâche à réaliser..."
          className="flex-1 liquid-glass-card-light rounded-lg border border-studio-border px-4 py-3 text-sm text-studio-text placeholder-studio-muted outline-none focus:border-studio-accent focus:ring-1 focus:ring-studio-accent"
        />
        <button
          onClick={runTask}
          disabled={running}
          className="rounded-lg bg-studio-accent px-6 py-3 text-sm font-medium text-white shadow-md transition-colors hover:bg-studio-accentDark disabled:opacity-50"
        >
          {running ? "..." : "Lancer"}
        </button>
      </div>
    </div>
  );
}
