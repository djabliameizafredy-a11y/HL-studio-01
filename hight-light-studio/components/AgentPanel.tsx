"use client";

import { useState } from "react";
import WorkspaceToolbar from "@/components/WorkspaceToolbar";

type AgentStep =
  | { type: "text"; content: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: string }
  | { type: "done" }
  | { type: "error"; message: string };

export default function AgentPanel() {
  const [task, setTask] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [running, setRunning] = useState(false);

  async function runTask() {
    if (!task.trim() || running) return;
    setSteps([]);
    setRunning(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
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
          setSteps((prev) => [...prev, JSON.parse(line)]);
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
