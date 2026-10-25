"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, StoredMessage, WorkspaceMode } from "@/lib/types";

interface HistoryResponse {
  conversationId: string | null;
  messages: StoredMessage[];
}

/**
 * Logique commune aux panneaux Chat, Design et Vidéo : chargement de
 * l'historique, envoi, lecture du flux SSE et suivi des tâches vidéo.
 *
 * Les trois panneaux parlaient au même endpoint avec trois copies du même
 * code ; les faire passer par ce hook garantit qu'un correctif de parsing
 * les corrige tous.
 */
export function useChatStream(mode: WorkspaceMode, modelId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [pendingJob, setPendingJob] = useState<string | null>(null);

  const conversationId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/history?mode=${mode}`)
      .then((res) => res.json())
      .then((data: HistoryResponse) => {
        if (cancelled) return;
        conversationId.current = data.conversationId;
        setMessages(
          (data.messages ?? []).map(({ role, content }) => ({ role, content }))
        );

        // Le dernier média de la conversation est réaffiché au rechargement
        // pour que l'utilisateur retrouve son image ou sa vidéo.
        const lastMedia = (data.messages ?? [])
          .flatMap((message) => message.media)
          .at(-1);
        if (lastMedia?.mediaType === "image") setImageUrl(lastMedia.url);
        if (lastMedia?.mediaType === "video") setVideoUrl(lastMedia.url);
      })
      .catch(() => {
        // L'historique est un confort : son échec ne doit pas bloquer l'envoi.
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
      setMessages(nextMessages);
      setLoading(true);
      setError(null);
      if (mode === "design") setImageUrl(null);
      if (mode === "video") setVideoUrl(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages,
            mode,
            modelId: modelId || undefined,
            conversationId: conversationId.current,
          }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error((payload as { error?: string }).error ?? `Erreur HTTP ${res.status}`);
        }
        if (!res.body) throw new Error("Pas de flux de réponse du serveur.");

        setMessages([...nextMessages, { role: "assistant", content: "" }]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          // La dernière ligne peut être incomplète : on la garde pour le
          // prochain paquet au lieu de tenter de la parser.
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            const event = JSON.parse(raw) as {
              text?: string;
              imageUrl?: string;
              videoUrl?: string;
              jobId?: string;
              conversationId?: string;
              error?: string;
            };

            if (event.error) throw new Error(event.error);
            if (event.conversationId) conversationId.current = event.conversationId;
            if (event.imageUrl) setImageUrl(event.imageUrl);
            if (event.videoUrl) setVideoUrl(event.videoUrl);
            if (event.jobId) setPendingJob(event.jobId);

            if (event.text) {
              answer += event.text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: answer };
                return updated;
              });
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur inconnue");
        // Retirer la bulle assistant restée vide, pour ne pas laisser un
        // message fantôme sous l'erreur.
        setMessages((prev) =>
          prev.at(-1)?.role === "assistant" && !prev.at(-1)?.content
            ? prev.slice(0, -1)
            : prev
        );
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, mode, modelId]
  );

  // Suivi d'une génération vidéo asynchrone : interrogation régulière
  // jusqu'à obtention du rendu ou erreur.
  useEffect(() => {
    if (!pendingJob) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/video/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: pendingJob,
            conversationId: conversationId.current,
          }),
        });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError(data.error ?? "Suivi de la tâche vidéo impossible.");
          setPendingJob(null);
          return;
        }
        if (data.status === "done") {
          setVideoUrl(data.videoUrl);
          setPendingJob(null);
        }
      } catch {
        // Erreur réseau passagère : on retentera au prochain tick.
      }
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingJob]);

  return { messages, loading, error, imageUrl, videoUrl, pendingJob, send };
}
