"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type FileEntry = { name: string; isDir: boolean; size?: number };
type Tab = "preview" | "code";

export default function PreviewPane() {
  const [tab, setTab] = useState<Tab>("preview");
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadingFs, setLoadingFs] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Export state
  const [exportOpen, setExportOpen] = useState(false);
  const [pushFormOpen, setPushFormOpen] = useState(false);
  const [pushUrl, setPushUrl] = useState("");
  const [pushMsg, setPushMsg] = useState("chore: update from Hight Light Studio");
  const [exportStatus, setExportStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const PREVIEW_URL =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_PREVIEW_URL ?? "http://localhost:3001"
      : "http://localhost:3001";

  const fetchEntries = useCallback(async (path: string) => {
    setLoadingFs(true);
    setFileContent(null);
    setSelectedFile(null);
    try {
      const res = await fetch(`/api/workspace?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.type === "dir") {
        setEntries(data.entries ?? []);
        setCurrentPath(path);
      }
    } catch {
      setEntries([]);
    } finally {
      setLoadingFs(false);
    }
  }, []);

  const fetchFile = useCallback(async (path: string) => {
    setLoadingFs(true);
    try {
      const res = await fetch(`/api/workspace?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.type === "file") {
        setFileContent(data.content);
        setSelectedFile(path);
      }
    } catch {
      setFileContent("Erreur lors de la lecture du fichier.");
    } finally {
      setLoadingFs(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "code") fetchEntries("");
  }, [tab, fetchEntries]);

  const handleEntryClick = (entry: FileEntry) => {
    const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    if (entry.isDir) {
      fetchEntries(newPath);
    } else {
      fetchFile(newPath);
    }
  };

  const navigateUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    fetchEntries(parts.join("/"));
  };

  const getLanguageFromPath = (filePath: string): string => {
    const ext = filePath.split(".").pop() ?? "";
    const map: Record<string, string> = {
      ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
      json: "json", md: "markdown", css: "css", html: "html",
      py: "python", sh: "bash", yml: "yaml", yaml: "yaml",
    };
    return map[ext] ?? "plaintext";
  };

  // ── Export helpers ───────────────────────────────────────────────────────
  async function downloadZip() {
    setExportLoading(true);
    setExportStatus(null);
    try {
      const res = await fetch("/api/workspace/download");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Erreur téléchargement");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workspace-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus({ type: "ok", text: "✓ Téléchargement démarré" });
    } catch (err) {
      setExportStatus({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setExportLoading(false);
    }
  }

  async function pushGithub() {
    setExportLoading(true);
    setExportStatus(null);
    try {
      const res = await fetch("/api/workspace/push-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: pushUrl.trim() || undefined, commitMessage: pushMsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur push");
      setExportStatus({ type: "ok", text: `✓ ${data.message}` });
      setPushFormOpen(false);
    } catch (err) {
      setExportStatus({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setExportLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full liquid-glass-card rounded-2xl overflow-hidden">
      {/* Header tabs */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-studio-border bg-white/30 backdrop-blur-md">
        <div className="flex gap-1">
          {(["preview", "code"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                tab === t
                  ? "bg-studio-accent text-white shadow-sm"
                  : "text-studio-muted hover:text-studio-text hover:bg-black/5"
              }`}
            >
              {t === "preview" ? "👁 Preview" : "🗂 Code"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {tab === "preview" && (
            <button
              onClick={() => setPreviewError(null)}
              className="text-xs text-studio-muted hover:text-studio-text transition-colors"
              title="Recharger"
            >
              ↺
            </button>
          )}

          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => { setExportOpen(o => !o); setExportStatus(null); }}
              className="flex items-center gap-1 rounded-lg bg-white/60 border border-studio-border px-3 py-1 text-xs font-medium text-studio-text hover:bg-white/80 transition-all shadow-sm"
            >
              📤 Exporter
            </button>

            {exportOpen && (
              <div className="absolute right-0 top-8 z-30 w-56 rounded-xl border border-studio-border bg-white/90 backdrop-blur-md shadow-lg p-2 flex flex-col gap-1">
                <button
                  onClick={() => { downloadZip(); setExportOpen(false); }}
                  disabled={exportLoading}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-studio-text hover:bg-black/5 transition-colors disabled:opacity-50 text-left w-full"
                >
                  <span>⬇️</span>
                  <span>Télécharger en .zip</span>
                </button>
                <button
                  onClick={() => { setPushFormOpen(o => !o); setExportOpen(false); }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-studio-text hover:bg-black/5 transition-colors text-left w-full"
                >
                  <span>🐙</span>
                  <span>Push vers GitHub</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Push GitHub form */}
      {pushFormOpen && (
        <div className="border-b border-studio-border bg-white/20 backdrop-blur-sm px-4 py-3 flex flex-col gap-2">
          <p className="text-xs font-medium text-studio-text">Push vers GitHub</p>
          <input
            value={pushUrl}
            onChange={(e) => setPushUrl(e.target.value)}
            placeholder="https://github.com/owner/repo (optionnel si remote déjà configuré)"
            className="w-full rounded-lg border border-studio-border bg-white/60 px-3 py-1.5 text-xs text-studio-text placeholder-studio-muted outline-none focus:border-studio-accent"
          />
          <input
            value={pushMsg}
            onChange={(e) => setPushMsg(e.target.value)}
            placeholder="Message de commit…"
            className="w-full rounded-lg border border-studio-border bg-white/60 px-3 py-1.5 text-xs text-studio-text placeholder-studio-muted outline-none focus:border-studio-accent"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setPushFormOpen(false)}
              className="text-xs text-studio-muted hover:text-studio-text px-3 py-1.5"
            >
              Annuler
            </button>
            <button
              onClick={pushGithub}
              disabled={exportLoading}
              className="rounded-lg bg-studio-accent px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-studio-accentDark disabled:opacity-50 transition-colors"
            >
              {exportLoading ? "Push…" : "🐙 Push"}
            </button>
          </div>
        </div>
      )}

      {/* Export status */}
      {exportStatus && (
        <div className={`px-4 py-1.5 text-xs border-b border-studio-border ${
          exportStatus.type === "ok" ? "text-studio-accentDark bg-green-50/50" : "text-red-500 bg-red-50/50"
        }`}>
          {exportStatus.text}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "preview" ? (
          previewError ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-studio-muted p-6">
              <span className="text-3xl">🚧</span>
              <p className="text-sm text-center">
                Le serveur de preview n'est pas encore démarré.<br />
                Lance un projet dans le Mode Agent pour l'activer.
              </p>
              <code className="text-xs bg-black/5 px-2 py-1 rounded">{PREVIEW_URL}</code>
            </div>
          ) : (
            <iframe
              key={tab}
              src={PREVIEW_URL}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
              onError={() => setPreviewError("Impossible de charger la preview.")}
              title="Live Preview"
            />
          )
        ) : (
          <div className="flex h-full text-sm font-mono">
            {/* File tree */}
            <div className="w-44 shrink-0 border-r border-studio-border overflow-y-auto py-2 bg-black/[0.02]">
              {currentPath && (
                <button
                  onClick={navigateUp}
                  className="w-full text-left px-3 py-1 text-studio-muted hover:bg-black/5 flex items-center gap-1 text-xs"
                >
                  ← ..
                </button>
              )}
              {currentPath && (
                <p className="px-3 py-1 text-[10px] text-studio-muted/60 truncate">{currentPath || "/"}</p>
              )}
              {loadingFs && !entries.length ? (
                <p className="px-3 py-2 text-studio-muted text-xs animate-pulse">Chargement…</p>
              ) : entries.length === 0 ? (
                <p className="px-3 py-2 text-studio-muted text-xs">Aucun fichier dans workspace/</p>
              ) : (
                entries.map((e) => (
                  <button
                    key={e.name}
                    onClick={() => handleEntryClick(e)}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 text-xs truncate transition-colors hover:bg-black/5 ${
                      selectedFile?.endsWith(e.name)
                        ? "text-studio-accent bg-studio-accent/10"
                        : "text-studio-text"
                    }`}
                  >
                    <span>{e.isDir ? "📁" : "📄"}</span>
                    <span className="truncate">{e.name}</span>
                  </button>
                ))
              )}
            </div>

            {/* File content */}
            <div className="flex-1 overflow-auto p-4 bg-white/20">
              {fileContent !== null ? (
                <pre className="text-xs leading-relaxed text-studio-text whitespace-pre-wrap break-words">
                  <code>{fileContent}</code>
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full text-studio-muted text-xs">
                  Sélectionne un fichier pour le lire.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
