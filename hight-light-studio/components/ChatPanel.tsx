"use client";

import { useState, useEffect } from "react";
import type { ChatMessage, WorkspaceMode, ModelId } from "@/lib/types";

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

export default function ChatPanel({ mode, model }: { mode: WorkspaceMode, model?: ModelId }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const { title, placeholder } = MODE_LABELS[mode];

  useEffect(() => {
    fetch(`/api/history?mode=${mode}`)
      .then(res => res.json())
      .then(data => {
        if (data.conversationId) setConversationId(data.conversationId);
        if (data.messages) {
           const formattedMessages = data.messages.map((m: any) => ({
             role: m.role,
             content: m.content
           }));
           setMessages(formattedMessages);
           
           // Récupérer le média du dernier message assistant si présent
           const lastMsg = data.messages[data.messages.length - 1];
           if (lastMsg?.generated_media?.[0]) {
             const media = lastMsg.generated_media[0];
             if (media.media_type === "image") setImageUrl(media.media_url);
             if (media.media_type === "video") setVideoUrl(media.media_url);
           }
        }
      })
      .catch(err => console.error("Erreur historique:", err));
  }, [mode]);

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
        body: JSON.stringify({ messages: nextMessages, mode, model, conversationId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? "Erreur inconnue");
      }

      setMessages([...nextMessages, { role: "assistant", content: "" }]);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";
      
      if (!reader) throw new Error("Pas de flux de réponse");

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep the incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (!dataStr.trim()) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.error) throw new Error(data.error);
              if (data.text) assistantMessage += data.text;
              if (data.imageUrl) setImageUrl(data.imageUrl);
              if (data.videoUrl) setVideoUrl(data.videoUrl);
              
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1].content = assistantMessage;
                return updated;
              });
            } catch (e) {
              if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
                 throw e;
              }
            }
          }
        }
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setMessages((prev) => {
         if (prev[prev.length -1]?.role === "assistant" && !prev[prev.length -1].content) {
            return prev.slice(0, -1);
         }
         return prev;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col liquid-glass-card rounded-xl p-4 overflow-hidden">
      <h2 className="mb-4 font-display text-2xl text-studio-text opacity-70">{title}</h2>

      <div className="flex-1 space-y-4 overflow-y-auto pr-2 mb-4">
        {messages.length === 0 && (
          <p className="text-sm text-studio-muted">{placeholder}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[80%] rounded-lg bg-studio-accent p-3 text-sm text-white"
                : "mr-auto max-w-[80%] rounded-lg liquid-glass-card-light p-3 text-sm text-studio-text"
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

      <div className="mt-auto flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={placeholder}
          data-help="Écris ton message puis appuie sur Entrée ou sur « Envoyer »."
          className="flex-1 liquid-glass-card-light rounded-lg border border-studio-border px-4 py-3 text-sm text-studio-text placeholder-studio-muted outline-none focus:border-studio-accent focus:ring-1 focus:ring-studio-accent"
        />
        <button
          onClick={sendMessage}
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
