import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------
// Préférences du bot, mémorisées dans un cookie.
//
// Pourquoi un cookie et pas localStorage : le stockage web est lié à
// l'origine COMPLÈTE (hôte + port). Si le port 3000 est occupé, HL Studio
// démarre sur 3001 et la préférence serait perdue. Les cookies ignorent le
// port, donc le choix de l'utilisateur survit.
// Il ne contient que "on/off" et "bienvenue déjà vue" : aucune donnée perso.
// ---------------------------------------------------------------------

const COOKIE = "hlstudio_bot";

export type BotPref = { enabled: boolean; seenWelcome: boolean };

const SERVER_PREF: BotPref = { enabled: true, seenWelcome: true };
let cache: BotPref | null = null;
const listeners = new Set<() => void>();

function readCookie(): BotPref {
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  const v = raw ? decodeURIComponent(raw) : "";
  return { enabled: !v.split(",").includes("off"), seenWelcome: v.split(",").includes("seen") };
}

function writePref(p: BotPref) {
  const v = [p.enabled ? "on" : "off", p.seenWelcome ? "seen" : ""].filter(Boolean).join(",");
  document.cookie = `${COOKIE}=${encodeURIComponent(v)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  cache = p;
  listeners.forEach((l) => l());
}

const getSnapshot = () => (cache ??= readCookie());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useBotPref = (): BotPref =>
  useSyncExternalStore(subscribe, getSnapshot, () => SERVER_PREF);

export const setBotEnabled = (enabled: boolean) =>
  writePref({ ...getSnapshot(), enabled });
export const markWelcomeSeen = () => writePref({ ...getSnapshot(), seenWelcome: true });

// --- Capacités du navigateur (écran tactile, mouvement réduit) ---------

function useMedia(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue
  );
}

/** Le bot n'existe que sur un appareil avec souris (pas sur écran tactile). */
export const useBotSupported = () =>
  useMedia("(hover: hover) and (pointer: fine)", false);
export const usePrefersReducedMotion = () =>
  useMedia("(prefers-reduced-motion: reduce)", false);
