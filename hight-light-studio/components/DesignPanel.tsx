"use client";

import { useState, useEffect } from "react";
import type { ChatMessage, ModelId } from "@/lib/types";

export default function DesignPanel({ model }: { model?: ModelId }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/history?mode=design`)
      .then(res => res.json())
      .then(data => {
        if (data.conversationId) setConversationId(data.conversationId);
        if (data.messages) {
           const formattedMessages = data.messages.map((m: any) => ({
             role: m.role,
             content: m.content
           }));
           setMessages(formattedMessages);
           
           const lastMsg = data.messages[data.messages.length - 1];
           if (lastMsg?.generated_media?.[0]?.media_type === "image") {
             setImageUrl(lastMsg.generated_media[0].media_url);
           }
        }
      })
      .catch(err => console.error("Erreur historique:", err));
  }, []);

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
    setImageUrl(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, mode: "design", model, conversationId }),
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
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (!dataStr.trim()) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.error) throw new Error(data.error);
              if (data.text) assistantMessage += data.text;
              if (data.imageUrl) setImageUrl(data.imageUrl);
              
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
      <div className="flex-1 overflow-y-auto pr-2 space-y-4 mb-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center flex-col space-y-4">
            <h2 className="font-display text-3xl text-studio-text opacity-70">Design Studio</h2>
            <p className="text-studio-muted text-center max-w-sm">
              Décrivez l'image ou le design que vous souhaitez générer avec Nano Banana.
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`mb-4 flex ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  m.role === "user"
                    ? "bg-studio-accent text-white"
                    : "liquid-glass-card-light text-studio-text"
                }`}
              >
                {m.content}
                {m.role === "assistant" && i === messages.length - 1 && imageUrl && (
                  <div className="mt-4 overflow-hidden rounded-lg border border-studio-border bg-black/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl}
                      alt="Génération Design"
                      className="w-full h-auto object-cover"
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="relative mt-auto">
        {error && (
          <div className="absolute bottom-full mb-2 w-full rounded bg-red-100 p-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 liquid-glass-card-light rounded-lg border-studio-border p-3 text-studio-text placeholder-studio-muted focus:border-studio-accent focus:outline-none focus:ring-1 focus:ring-studio-accent"
            placeholder="Générer un design..."
            data-help="Décris le visuel voulu : style, couleurs, format. Entrée pour lancer."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            data-help="Lance la génération avec le modèle sélectionné. Cela utilise ta clé API."
            className="rounded-lg bg-studio-accent px-6 py-3 font-medium text-white hover:bg-studio-accentDark disabled:opacity-50 transition-colors shadow-md"
          >
            {loading ? "..." : "Générer"}
          </button>
        </div>
      </div>
    </div>
  );
}
