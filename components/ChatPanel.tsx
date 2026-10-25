"use client";

import { useState } from "react";
import { useChatStream } from "@/lib/client/useChatStream";
import type { WorkspaceMode } from "@/lib/types";

const MODE_LABELS: Record<WorkspaceMode, { title: string; placeholder: string }> = {
  chat: {
    title: "Chat multi-modèles",
    placeholder: "Pose une question, compare les modèles...",
  },
  code: {
    title: "Code & architecture",
    placeholder: "Décris la fonctionnalité ou le problème technique...",
  },
  design: {
    title: "Design & images",
    placeholder: "Décris l'écran ou le visuel à générer...",
  },
  video: {
    title: "Vidéo",
    placeholder: "Décris la vidéo à générer (landing page, démo produit...)",
  },
};

export default function ChatPanel({
  mode,
  modelId,
}: {
  mode: WorkspaceMode;
  modelId: string;
}) {
  const [input, setInput] = useState("");
  const { messages, loading, error, imageUrl, send } = useChatStream(mode, modelId);
  const { title, placeholder } = MODE_LABELS[mode];

  function submit() {
    const value = input;
    setInput("");
    void send(value);
  }

  return (
    <div className="liquid-glass-card flex h-full flex-col overflow-hidden rounded-xl p-4">
      <h2 className="mb-4 font-display text-2xl text-studio-text opacity-70">{title}</h2>

      <div className="mb-4 flex-1 space-y-4 overflow-y-auto pr-2">
        {messages.length === 0 && <p className="text-sm text-studio-muted">{placeholder}</p>}

        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "ml-auto max-w-[80%] rounded-lg bg-studio-accent p-3 text-sm text-white"
                : "liquid-glass-card-light mr-auto max-w-[80%] whitespace-pre-wrap rounded-lg p-3 text-sm text-studio-text"
            }
          >
            {message.content}
          </div>
        ))}

        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Image générée" className="rounded-lg" />
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      <div className="mt-auto flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          disabled={loading}
          data-help="Écris ton message puis appuie sur Entrée ou sur « Envoyer »."
          className="liquid-glass-card-light flex-1 rounded-lg border border-studio-border px-4 py-3 text-sm text-studio-text placeholder-studio-muted outline-none focus:border-studio-accent focus:ring-1 focus:ring-studio-accent"
        />
        <button
          onClick={submit}
          disabled={loading}
          data-help="Envoie ton message au modèle sélectionné en haut à droite. L'envoi utilise ta clé API."
          className="rounded-lg bg-studio-accent px-6 py-3 text-sm font-medium text-white shadow-md transition-colors hover:bg-studio-accentDark disabled:opacity-50"
        >
          {loading ? "..." : "Envoyer"}
        </button>
      </div>
    </div>
  );
}
