"use client";

import { useRef, useState } from "react";

type ImportMode = "file" | "github" | null;

interface ConfirmState {
  repoUrl: string;
  fileCount: number;
}

export default function WorkspaceToolbar() {
  const [importMode, setImportMode] = useState<ImportMode>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Import fichier(s) / zip ──────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;

    setLoading(true);
    setStatus(null);

    const formData = new FormData();
    for (const file of Array.from(files)) {
      formData.append("files", file);
    }

    try {
      const res = await fetch("/api/workspace/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur upload");
      setStatus({ type: "ok", message: `✓ Importé : ${data.uploaded.join(", ")}` });
      setImportMode(null);
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Import GitHub ────────────────────────────────────────────────────────
  async function handleGithubImport(confirm = false) {
    if (!githubUrl.trim()) return;
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch("/api/workspace/import-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: githubUrl.trim(), confirm }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Erreur clone");

      if (data.needsConfirm) {
        setConfirmState({ repoUrl: githubUrl.trim(), fileCount: data.fileCount });
        setLoading(false);
        return;
      }

      setStatus({ type: "ok", message: `✓ ${data.message}` });
      setImportMode(null);
      setGithubUrl("");
      setConfirmState(null);
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Barre d'actions principale */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-studio-muted font-medium mr-1">workspace/</span>

        {/* Bouton Importer */}
        <div className="relative">
          <button
            onClick={() => setImportMode(importMode ? null : "file")}
            data-help="Importe des fichiers, un .zip ou un dépôt GitHub dans le workspace de l'agent."
            className="flex items-center gap-1.5 rounded-lg bg-white/60 border border-studio-border px-3 py-1.5 text-xs font-medium text-studio-text hover:bg-white/80 transition-all shadow-sm"
          >
            📥 Importer
          </button>
        </div>

        {/* Dropdown mode import */}
        {importMode && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
            <button
              onClick={() => setImportMode("file")}
              className={`rounded-lg px-3 py-1.5 text-xs transition-all border ${
                importMode === "file"
                  ? "bg-studio-accent text-white border-studio-accent"
                  : "bg-white/50 border-studio-border text-studio-muted hover:text-studio-text"
              }`}
            >
              📄 Fichier(s) / .zip
            </button>
            <button
              onClick={() => setImportMode("github")}
              className={`rounded-lg px-3 py-1.5 text-xs transition-all border ${
                importMode === "github"
                  ? "bg-studio-accent text-white border-studio-accent"
                  : "bg-white/50 border-studio-border text-studio-muted hover:text-studio-text"
              }`}
            >
              🐙 GitHub
            </button>
          </div>
        )}
      </div>

      {/* Zone upload fichier */}
      {importMode === "file" && (
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="*/*"
            onChange={handleFileUpload}
            className="text-xs text-studio-muted file:mr-3 file:rounded-lg file:border-0 file:bg-studio-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-studio-accentDark cursor-pointer"
            disabled={loading}
          />
          {loading && <span className="text-xs text-studio-muted animate-pulse">Upload…</span>}
        </div>
      )}

      {/* Zone import GitHub */}
      {importMode === "github" && !confirmState && (
        <div className="flex items-center gap-2">
          <input
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGithubImport(false)}
            placeholder="https://github.com/owner/repo"
            className="flex-1 liquid-glass-card-light rounded-lg border border-studio-border px-3 py-1.5 text-xs text-studio-text placeholder-studio-muted outline-none focus:border-studio-accent"
            disabled={loading}
          />
          <button
            onClick={() => handleGithubImport(false)}
            disabled={loading || !githubUrl.trim()}
            className="rounded-lg bg-studio-accent px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-studio-accentDark disabled:opacity-50 transition-colors"
          >
            {loading ? "Clonage…" : "Cloner"}
          </button>
        </div>
      )}

      {/* Confirmation écrasement workspace */}
      {confirmState && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <span className="text-xs text-amber-700 flex-1">
            ⚠️ workspace/ contient {confirmState.fileCount} fichier(s). Écraser ?
          </span>
          <button
            onClick={() => { setConfirmState(null); setImportMode(null); }}
            className="text-xs text-amber-600 hover:text-amber-800 px-2 py-1"
          >
            Annuler
          </button>
          <button
            onClick={() => handleGithubImport(true)}
            disabled={loading}
            className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {loading ? "Clonage…" : "Confirmer"}
          </button>
        </div>
      )}

      {/* Feedback status */}
      {status && (
        <p className={`text-xs ${status.type === "ok" ? "text-studio-accentDark" : "text-red-500"}`}>
          {status.message}
        </p>
      )}
    </div>
  );
}
