"use client";

import { setBotEnabled, useBotPref, useBotSupported } from "@/lib/bot/preference";

// Contrôles de l'assistant dans l'en-tête : activer/masquer, et ouvrir l'aide.
// Invisible sur écran tactile (le bot n'y existe pas).
export default function BotToggle() {
  const supported = useBotSupported();
  const { enabled } = useBotPref();
  if (!supported) return null;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => setBotEnabled(!enabled)}
        data-help="Affiche ou masque l'assistant flottant. Ton choix est mémorisé."
        className="flex items-center gap-1.5 rounded-lg border border-studio-border bg-white/60 px-3 py-1.5 text-xs font-medium text-studio-text transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 rounded-full ${enabled ? "bg-[#0F9D58]" : "bg-studio-muted/50"}`}
        />
        Assistant
      </button>
      {enabled && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("hlbot:open"))}
          aria-label="Ouvrir l'aide de l'assistant"
          data-help="Ouvre l'aide de l'assistant : astuces du mode actif et possibilité de lui poser une question."
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-studio-border bg-white/60 text-xs font-semibold text-studio-text transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"
        >
          ?
        </button>
      )}
    </div>
  );
}
