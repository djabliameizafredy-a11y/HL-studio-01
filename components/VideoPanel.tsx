"use client";

import { useState } from "react";
import { useChatStream } from "@/lib/client/useChatStream";

export default function VideoPanel({ modelId }: { modelId: string }) {
  const [input, setInput] = useState("");
  const { messages, loading, error, videoUrl, pendingJob, send } = useChatStream(
    "video",
    modelId
  );

  function submit() {
    const value = input;
    setInput("");
    void send(value);
  }

  return (
    <div className="liquid-glass-card flex h-full flex-col overflow-hidden rounded-xl p-4">
      <div className="mb-4 flex-1 space-y-4 overflow-y-auto pr-2">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center space-y-4">
            <h2 className="font-display text-3xl text-studio-text opacity-70">
              Video Studio
            </h2>
            <p className="max-w-sm text-center text-studio-muted">
              Décris la vidéo à générer. Le rendu est asynchrone chez la plupart des
              fournisseurs : compte plusieurs minutes.
            </p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={`mb-4 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === "user"
                    ? "bg-studio-accent text-white"
                    : "liquid-glass-card-light text-studio-text"
                }`}
              >
                {message.content}

                {message.role === "assistant" &&
                  index === messages.length - 1 &&
                  videoUrl && (
                    <div className="mt-4 overflow-hidden rounded-lg border border-studio-border bg-black/5">
                      <video
                        src={videoUrl}
                        controls
                        loop
                        className="h-auto w-full object-cover"
                      />
                    </div>
                  )}
              </div>
            </div>
          ))
        )}

        {pendingJob && (
          <p className="animate-pulse text-xs text-studio-muted">
            Rendu en cours… HL Studio interroge le fournisseur toutes les 10 secondes.
          </p>
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
            className="liquid-glass-card-light flex-1 rounded-lg border-studio-border p-3 text-studio-text placeholder-studio-muted focus:border-studio-accent focus:outline-none focus:ring-1 focus:ring-studio-accent"
            placeholder="Générer une vidéo..."
            data-help="Décris la scène voulue. Entrée pour lancer la génération."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            disabled={loading || Boolean(pendingJob)}
          />
          <button
            onClick={submit}
            disabled={loading || Boolean(pendingJob)}
            data-help="Lance la génération vidéo. Cela utilise ta clé API et peut prendre du temps."
            className="rounded-lg bg-studio-accent px-6 py-3 font-medium text-white shadow-md transition-colors hover:bg-studio-accentDark disabled:opacity-50"
          >
            {loading ? "..." : "Générer"}
          </button>
        </div>
      </div>
    </div>
  );
}
