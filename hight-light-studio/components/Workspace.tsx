"use client";

import { useState } from "react";
import type { WorkspaceMode, ModelId } from "@/lib/types";
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

// Modèles disponibles selon le mode actif
const MODELS_BY_MODE: Record<WorkspaceMode, { id: ModelId; label: string }[]> = {
  chat: [
    { id: "claude", label: "Claude Sonnet 5" },
    { id: "kimi-k3", label: "Kimi K3" },
    { id: "glm-5.2", label: "GLM-5.2" },
    { id: "gemma-4", label: "Gemma 4" },
    { id: "freellmapi", label: "FreeLLMAPI (Local Router)" },
    { id: "gemma-4-free", label: "Gemma 4 (Free - OpenRouter)" },
    { id: "nemotron-free", label: "Nemotron (Free - OpenRouter)" },
  ],
  code: [
    { id: "kimi-k3", label: "Kimi K3 ✦ défaut" },
    { id: "kimi", label: "Kimi K2.7-Code" },
    { id: "claude", label: "Claude Sonnet 5" },
    { id: "glm-5.2", label: "GLM-5.2" },
    { id: "freellmapi", label: "FreeLLMAPI (Local Router)" },
  ],
  design: [
    { id: "nano-banana", label: "Nano Banana ✦ défaut" },
    { id: "claude", label: "Claude Sonnet 5" },
  ],
  video: [
    { id: "wan", label: "Wan 2.7 ✦ défaut" },
  ],
};

export default function Workspace() {
  const [active, setActive] = useState<WorkspaceMode>("chat");
  const [selectedModels, setSelectedModels] = useState<Record<WorkspaceMode, ModelId>>({
    chat: "claude",
    code: "kimi-k3",
    design: "nano-banana",
    video: "wan",
  });

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModels(prev => ({ ...prev, [active]: e.target.value as ModelId }));
  };

  return (
    <div className="flex h-screen flex-col p-4 gap-4 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-studio-accent to-purple-500 shadow-md" />
          <div>
            <h1 className="text-base font-semibold leading-tight">Hight Light Studio</h1>
            <p className="text-xs text-studio-muted">Workspace IA multi-modèles</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <BotToggle />
          {/* Model selector */}
          <select
            value={selectedModels[active]}
            data-help="Modèle d'IA utilisé dans ce mode. Chaque mode a sa propre liste."
            onChange={handleModelChange}
            className="rounded-lg border border-studio-border bg-white/60 backdrop-blur-sm px-3 py-1.5 text-xs text-studio-text outline-none focus:border-studio-accent transition-colors"
          >
            {MODELS_BY_MODE[active].map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          {/* Tab nav */}
          <nav className="flex gap-0.5 rounded-full border border-studio-border bg-white/50 backdrop-blur-md p-1 shadow-sm">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                title={tab.label}
                data-help={tab.help}
                className={
                  active === tab.id
                    ? "rounded-full bg-studio-accent px-4 py-1.5 text-xs font-medium text-white shadow-md transition-all"
                    : "rounded-full px-4 py-1.5 text-xs text-studio-muted hover:text-studio-text hover:bg-black/5 transition-all"
                }
              >
                <span className="hidden sm:inline">{tab.emoji} {tab.label}</span>
                <span className="sm:hidden">{tab.emoji}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main grid — 2 columns (panneau gauche + preview droite) */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 overflow-hidden min-h-0">
        {/* Left pane — active panel */}
        <div className="flex flex-col overflow-hidden min-h-0">
          {active === "code"   && <AgentPanel />}
          {active === "chat"   && <ChatPanel mode="chat" model={selectedModels.chat} />}
          {active === "design" && <DesignPanel model={selectedModels.design} />}
          {active === "video"  && <VideoPanel model={selectedModels.video} />}
        </div>

        {/* Right pane — Preview / Code browser (visible uniquement xl+) */}
        <div className="hidden xl:flex flex-col min-h-0">
          <PreviewPane />
        </div>
      </div>

      <HelperBot panel={active} />
    </div>
  );
}
