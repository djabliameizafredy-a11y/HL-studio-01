"use client";

import { useState } from "react";
import type { WorkspaceMode } from "@/lib/types";
import ChatPanel from "@/components/ChatPanel";
import AgentPanel from "@/components/AgentPanel";

const TABS: { id: WorkspaceMode; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "code", label: "Code" },
  { id: "design", label: "Design" },
  { id: "video", label: "Vidéo" },
];

export default function Workspace() {
  const [active, setActive] = useState<WorkspaceMode>("chat");

  return (
    <div className="mx-auto flex h-screen max-w-4xl flex-col p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium">Hight Light Studio</h1>
          <p className="text-sm text-studio-muted">
            Le workspace IA multi-modèles de Hight Light.
          </p>
        </div>
      </header>

      <nav className="mb-4 flex gap-1 rounded-lg border border-studio-border bg-studio-panel p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={
              active === tab.id
                ? "flex-1 rounded-md bg-studio-accent py-2 text-sm font-medium text-studio-bg"
                : "flex-1 rounded-md py-2 text-sm text-studio-muted hover:text-studio-text"
            }
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-hidden">
        {active === "code" ? <AgentPanel /> : <ChatPanel mode={active} />}
      </div>
    </div>
  );
}
