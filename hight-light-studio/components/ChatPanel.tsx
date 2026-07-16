"use client";

import { useState } from "react";
import type { ChatMessage, WorkspaceMode } from "@/lib/types";

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

export default function ChatPanel({ mode }: { mode: WorkspaceMode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const { title, placeholder } = MODE_LABELS[mode];

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: input },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, mode }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Erreur inconnue");

      setMessages([...nextMessages, { role: "assistant", content: data.text }]);
      if (data.imageUrl) setImageUrl(data.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-4 text-sm font-medium text-studio-muted">{title}</h2>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-studio-border bg-studio-panel p-4">
        {messages.length === 0 && (
          <p className="text-sm text-studio-muted">{placeholder}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[80%] rounded-lg bg-studio-accentDark/20 p-3 text-sm"
                : "mr-auto max-w-[80%] rounded-lg bg-studio-border/40 p-3 text-sm"
            }
          >
            {m.content}
          </div>
        ))}
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Image générée" className="rounded-lg" />
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-studio-border bg-studio-panel px-3 py-2 text-sm outline-none focus:border-studio-accent"
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          className="rounded-lg bg-studio-accent px-4 py-2 text-sm font-medium text-studio-bg disabled:opacity-50"
        >
          {loading ? "..." : "Envoyer"}
        </button>
      </div>
    </div>
  );
}
