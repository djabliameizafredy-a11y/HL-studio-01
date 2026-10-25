"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import {
  CAPABILITY_BY_MODE,
  type PublicConfig,
  type WorkspaceMode,
} from "@/lib/types";
import { fetchConfig } from "@/lib/client/settingsApi";
import ChatPanel from "@/components/ChatPanel";
import AgentPanel from "@/components/AgentPanel";
import DesignPanel from "@/components/DesignPanel";
import VideoPanel from "@/components/VideoPanel";
import PreviewPane from "@/components/PreviewPane";
import HelperBot from "@/components/HelperBot";
import BotToggle from "@/components/BotToggle";

const TABS: { id: WorkspaceMode; label: string; emoji: string; help: string }[] = [
  { id: "chat", label: "Chat", emoji: "💬", help: "Chat : discute avec le modèle d'IA (questions, idées, rédaction)." },
  { id: "code", label: "Code", emoji: "🛠", help: "Code : l'agent lit et modifie les fichiers de ton workspace. Il te demande ton accord avant d'exécuter une commande." },
  { id: "design", label: "Design", emoji: "🎨", help: "Design : génère des visuels à partir d'une description." },
  { id: "video", label: "Vidéo", emoji: "🎬", help: "Vidéo : génère une courte vidéo à partir d'un texte." },
];

export default function Workspace() {
  const [active, setActive] = useState<WorkspaceMode>("chat");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  // Choix ponctuel dans l'en-tête, qui n'écrase pas l'assignation
  // enregistrée dans les Réglages.
  const [overrides, setOverrides] = useState<Partial<Record<WorkspaceMode, string>>>({});

  const reload = useCallback(async () => {
    try {
      setConfig(await fetchConfig());
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Modèles proposés pour le mode actif : même règle que les Réglages, pour
  // ne jamais offrir un modèle que le serveur refuserait.
  const availableModels = (config?.models ?? []).filter(
    (model) =>
      model.capabilities.includes(CAPABILITY_BY_MODE[active]) &&
      (active !== "code" || model.supportsTools)
  );

  const selectedModelId =
    overrides[active] ?? config?.assignments[active] ?? availableModels[0]?.id ?? "";

  const hasModel = Boolean(selectedModelId);

  return (
    <div className="flex h-screen flex-col gap-4 overflow-hidden p-4">
      <header className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-studio-accent to-purple-500 shadow-md" />
          <div>
            <h1 className="text-base font-semibold leading-tight">HL Studio</h1>
            <p className="text-xs text-studio-muted">Studio IA local, multi-modèles</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <BotToggle />

          <select
            value={selectedModelId}
            disabled={availableModels.length === 0}
            data-help="Modèle utilisé dans ce mode. Seuls les modèles compatibles avec le mode actif sont proposés."
            onChange={(e) => setOverrides((prev) => ({ ...prev, [active]: e.target.value }))}
            className="rounded-lg border border-studio-border bg-white/60 px-3 py-1.5 text-xs text-studio-text outline-none backdrop-blur-sm transition-colors focus:border-studio-accent disabled:opacity-60"
          >
            {availableModels.length === 0 ? (
              <option value="">Aucun modèle configuré</option>
            ) : (
              availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))
            )}
          </select>

          <Link
            href="/settings"
            title="Réglages"
            data-help="Réglages : ajoute tes fournisseurs d'IA, tes modèles et tes clés d'API."
            className="rounded-lg border border-studio-border bg-white/60 p-1.5 text-studio-muted transition-colors hover:text-studio-text"
          >
            <Settings className="h-4 w-4" />
          </Link>

          <nav className="flex gap-0.5 rounded-full border border-studio-border bg-white/50 p-1 shadow-sm backdrop-blur-md">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                title={tab.label}
                data-help={tab.help}
                className={
                  active === tab.id
                    ? "rounded-full bg-studio-accent px-4 py-1.5 text-xs font-medium text-white shadow-md transition-all"
                    : "rounded-full px-4 py-1.5 text-xs text-studio-muted transition-all hover:bg-black/5 hover:text-studio-text"
                }
              >
                <span className="hidden sm:inline">
                  {tab.emoji} {tab.label}
                </span>
                <span className="sm:hidden">{tab.emoji}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {!hasModel && (
        <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2 text-xs text-amber-800">
          Aucun modèle n&apos;est configuré pour le mode {active}.{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Ouvre les Réglages
          </Link>{" "}
          pour ajouter un fournisseur et un modèle.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden xl:grid-cols-[420px_1fr]">
        <div className="flex min-h-0 flex-col overflow-hidden">
          {active === "code" && <AgentPanel modelId={selectedModelId} />}
          {active === "chat" && <ChatPanel mode="chat" modelId={selectedModelId} />}
          {active === "design" && <DesignPanel modelId={selectedModelId} />}
          {active === "video" && <VideoPanel modelId={selectedModelId} />}
        </div>

        <div className="hidden min-h-0 flex-col xl:flex">
          <PreviewPane />
        </div>
      </div>

      <HelperBot panel={active} />
    </div>
  );
}
