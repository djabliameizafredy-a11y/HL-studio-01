"use client";

import { useEffect, useRef, useState } from "react";
import { Blobatar } from "@blobatar/react";
import { useGaze } from "@blobatar/react/gaze";
import { happy, idle, sad, thinking } from "blobatar/expression";
import "blobatar/motion.css";
import "blobatar/gaze.css";
import type { WorkspaceMode } from "@/lib/types";
import {
  avoidRects,
  clampToViewport,
  followTarget,
  inflate,
  intersects,
  lerpFactor,
  placeBeside,
  rectFrom,
  type Point,
  type Rect,
  type Size,
} from "@/lib/bot/geometry";
import {
  BUBBLE_MS,
  HOVER_MS,
  IDLE_MS,
  MAX_IDLE_TIPS,
  PANEL_TIPS,
  WELCOME,
} from "@/lib/bot/helpTexts";
import {
  markWelcomeSeen,
  setBotEnabled,
  useBotPref,
  useBotSupported,
  usePrefersReducedMotion,
} from "@/lib/bot/preference";

// ---------------------------------------------------------------------
// Bot assistant flottant.
//  - Avatar : package npm `blobatar` (MIT), rendu local, aucun appel réseau.
//  - Suit le curseur (lerp + requestAnimationFrame, transform écrit
//    directement dans le DOM : aucun setState par mouvement de souris).
//  - Aide : textes STATIQUES déclarés avec data-help="..." dans l'interface.
//    Aucun appel IA sans clic explicite de l'utilisateur.
//  - Ne recouvre jamais le champ de saisie actif.
//  - Inexistant sur écran tactile ; immobile (coin) avec prefers-reduced-motion.
// ---------------------------------------------------------------------

const BOT = 56;
const BOT_SIZE: Size = { w: BOT, h: BOT };
const EXPRESSIONS = { idle, happy, thinking, sad } as const;
type ExprName = keyof typeof EXPRESSIONS;

type BubbleKind = "help" | "tip" | "welcome" | "answer" | "error";
type Bubble = {
  kind: BubbleKind;
  text: string;
  anchor: HTMLElement | null; // élément décrit (le bot s'en approche)
  auto: boolean; // ouverte par le bot lui-même : se ferme si la souris s'éloigne
  sticky: boolean; // ne se ferme pas toute seule (échange avec l'utilisateur)
  focusOnOpen?: boolean; // ouverte au clavier : le focus entre dans la bulle
};
type Mode = "follow" | "visit" | "hold";

const NON_TEXT_INPUTS = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color",
]);

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/** Champ de saisie (ou éditeur de code) actuellement actif, hors du bot. */
function focusedEditable(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || a.closest("[data-hl-bot]")) return null;
  const isText =
    a.tagName === "TEXTAREA" ||
    (a.tagName === "INPUT" && !NON_TEXT_INPUTS.has((a as HTMLInputElement).type)) ||
    a.isContentEditable ||
    a.getAttribute("role") === "textbox";
  if (!isText) return null;
  return (a.closest("[data-bot-avoid], .monaco-editor, .cm-editor") as HTMLElement) ?? a;
}

/** Éléments portant data-help et réellement visibles à l'écran. */
function visibleHelpEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-help]")).filter((el) => {
    if (el.closest("[data-hl-bot]")) return false;
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth &&
      getComputedStyle(el).visibility !== "hidden"
    );
  });
}

const helpEl = (n: EventTarget | null): HTMLElement | null =>
  n instanceof Element ? (n.closest("[data-help]") as HTMLElement | null) : null;

type Api = { close(): void; show(b: Bubble): void; placeBubble(): void; makeSticky(): void };

// Composant réellement actif : n'existe QUE tant que le bot est affiché. Quand on le
// masque, il est démonté, ce qui retire tous ses écouteurs (y compris ceux du moteur
// de regard de blobatar, dont le hook vit aussi longtemps que le composant).
function ActiveBot({ panel }: { panel: WorkspaceMode }) {
  const pref = useBotPref();
  const reduced = usePrefersReducedMotion();

  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [expr, setExpr] = useState<ExprName>("idle");
  const [askOpen, setAskOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const { ref: gazeRef, lookAt } = useGaze({ travel: 3 });

  // État mutable de la boucle d'animation : jamais de setState par frame.
  const st = useRef({
    pos: { x: -200, y: -200 } as Point,
    goal: { x: -200, y: -200 } as Point,
    placedGoal: { x: -9999, y: -9999 } as Point,
    mode: "follow" as Mode,
    pointer: { x: 0, y: 0, seen: false },
    openPointer: { x: 0, y: 0 },
    anchor: null as HTMLElement | null,
    raf: 0,
    lastT: 0,
    covered: false,
    shownOnce: false,
    bubble: null as Bubble | null,
    panel,
    reduced,
    modality: "pointer" as "pointer" | "keyboard",
    lastActivity: 0,
    idleFired: false,
    idleCount: 0,
    tourIndex: 0,
    tipIndex: 0,
    overBubble: false,
    // Le curseur est au-dessus d'une iframe (l'aperçu) : la page parente ne reçoit
    // alors plus AUCUN événement souris (comportement normal des navigateurs).
    overFrame: false,
    hoverEl: null as HTMLElement | null,
    hoverTimer: 0,
    closeTimer: 0,
    returnFocus: null as HTMLElement | null,
  });
  st.current.panel = panel;
  st.current.reduced = reduced;
  st.current.bubble = bubble;

  const api = useRef<Api>({ close() {}, show() {}, placeBubble() {}, makeSticky() {} });

  // ------------------------- boucle et événements -------------------------
  useEffect(() => {
    const s = st.current;
    const root = rootRef.current;
    if (!root) return;

    const vw = () => window.innerWidth;
    const vh = () => window.innerHeight;
    const corner = (): Point => ({ x: vw() - BOT - 16, y: vh() - BOT - 16 });
    const avoidList = (): Rect[] => {
      const e = focusedEditable();
      return e ? [rectOf(e)] : [];
    };

    // Position visée, ou null si le bot ne peut pas être affiché sans
    // recouvrir le champ de saisie actif (il est alors masqué).
    const computeTarget = (zones: Rect[]): Point | null => {
      if (s.reduced) {
        const c = corner();
        return zones.some((z) => intersects(rectFrom(c, BOT_SIZE), inflate(z, 10))) ? null : c;
      }
      // Sur l'aperçu, impossible de suivre le curseur : le bot se masque (sauf
      // si une bulle est ouverte, qu'on ne retire pas sous les yeux de l'utilisateur).
      if (s.overFrame && !s.bubble) return null;
      let t: Point;
      if (s.mode === "hold") t = s.pos;
      else if (s.mode === "visit" && s.anchor && s.anchor.isConnected) {
        t = placeBeside(rectOf(s.anchor), BOT_SIZE, zones, vw(), vh()) ?? s.pos;
      } else if (!s.pointer.seen) t = corner();
      else t = followTarget(s.pointer, BOT_SIZE, vw(), vh());
      return avoidRects(t, BOT_SIZE, zones, vw(), vh());
    };

    const updateRing = () => {
      const ring = ringRef.current;
      if (!ring) return;
      if (s.bubble && s.anchor && s.anchor.isConnected) {
        const r = rectOf(s.anchor);
        ring.style.display = "block";
        ring.style.left = `${r.left - 4}px`;
        ring.style.top = `${r.top - 4}px`;
        ring.style.width = `${r.right - r.left + 8}px`;
        ring.style.height = `${r.bottom - r.top + 8}px`;
      } else ring.style.display = "none";
    };

    const placeBubble = () => {
      const b = bubbleRef.current;
      if (!b || !s.bubble) return;
      const size: Size = { w: b.offsetWidth, h: b.offsetHeight };
      const avoid = avoidList();
      if (s.anchor) avoid.push(rectOf(s.anchor));
      let p = placeBeside(rectFrom(s.goal, BOT_SIZE), size, avoid, vw(), vh());
      if (!p) {
        if (s.bubble.sticky) {
          // Action explicite de l'utilisateur : on l'affiche coûte que coûte.
          p = clampToViewport({ x: s.goal.x - size.w - 10, y: s.goal.y - size.h - 10 }, size, vw(), vh());
        } else {
          api.current.close(); // ne jamais recouvrir une zone de saisie
          return;
        }
      }
      b.style.left = `${p.x - s.goal.x}px`;
      b.style.top = `${p.y - s.goal.y}px`;
      b.style.visibility = "visible";
      s.placedGoal = { ...s.goal };
      updateRing();
    };

    const tick = (t: number) => {
      s.raf = 0;
      const dt = s.lastT ? Math.min(t - s.lastT, 64) : 16;
      s.lastT = t;
      const zones = avoidList();
      const target = computeTarget(zones);
      const goal = target ?? s.pos;
      s.goal = goal;
      const k = s.reduced ? 1 : lerpFactor(dt, s.mode === "visit" ? 240 : 120);
      s.pos = { x: s.pos.x + (goal.x - s.pos.x) * k, y: s.pos.y + (goal.y - s.pos.y) * k };
      const settled = Math.hypot(goal.x - s.pos.x, goal.y - s.pos.y) < 0.4;
      if (settled) s.pos = goal;
      // La position AFFICHÉE ne doit jamais recouvrir le champ actif non plus : le trajet
      // en ligne droite vers la cible peut le traverser, le bot s'efface alors le temps
      // de la traversée.
      const crossing = zones.some((z) => intersects(rectFrom(s.pos, BOT_SIZE), inflate(z, 4)));
      const hide = target === null || crossing;
      // Opacité écrite directement (pas d'état React, pas de transition au masquage) :
      // l'avatar disparaît dans la MÊME image que celle où il toucherait le champ.
      if (hide !== s.covered || !s.shownOnce) {
        s.covered = hide;
        s.shownOnce = true;
        const v = visualRef.current;
        if (v) {
          v.style.transition = hide ? "none" : "opacity 150ms ease";
          v.style.opacity = hide ? "0" : "1";
        }
      }
      root.style.transform = `translate3d(${s.pos.x.toFixed(1)}px, ${s.pos.y.toFixed(1)}px, 0)`;
      if (s.bubble && Math.hypot(goal.x - s.placedGoal.x, goal.y - s.placedGoal.y) > 1) placeBubble();
      updateRing();
      if (settled) s.lastT = 0;
      else s.raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    };

    const show = (b: Bubble) => {
      window.clearTimeout(s.closeTimer);
      if (!s.bubble) s.returnFocus = document.activeElement as HTMLElement | null;
      s.anchor = b.anchor;
      s.mode = b.anchor ? "visit" : "hold";
      s.openPointer = { x: s.pointer.x, y: s.pointer.y };
      s.placedGoal = { x: -9999, y: -9999 };
      s.bubble = b;
      setBubble(b);
      setExpr(b.kind === "error" ? "sad" : "happy");
      if (b.anchor) lookAt(b.anchor);
      if (!b.sticky) s.closeTimer = window.setTimeout(close, BUBBLE_MS);
      kick();
    };

    function close() {
      window.clearTimeout(s.closeTimer);
      const wasOpen = !!s.bubble;
      s.anchor = null;
      s.mode = "follow";
      s.bubble = null;
      s.overBubble = false;
      setBubble(null);
      setAskOpen(false);
      setAsking(false);
      setExpr("idle");
      lookAt("pointer");
      if (ringRef.current) ringRef.current.style.display = "none";
      // Rend le focus à l'élément d'origine si on l'avait déplacé dans la bulle.
      if (wasOpen && bubbleRef.current?.contains(document.activeElement)) {
        const back = s.returnFocus;
        if (back && back.isConnected) back.focus();
      }
      kick();
    }

    const makeSticky = () => {
      window.clearTimeout(s.closeTimer);
      if (s.bubble) {
        s.bubble = { ...s.bubble, sticky: true, auto: false };
        setBubble(s.bubble);
      }
    };

    api.current = { close, show, placeBubble, makeSticky };

    // --- Aide au survol et au focus clavier ---
    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const target = e.target as Element;
      if (target.tagName === "IFRAME") {
        s.overFrame = true;
        kick();
        return;
      }
      if (target.closest("[data-hl-bot]")) return;
      const el = helpEl(target);
      if (!el || el === s.hoverEl) return;
      s.hoverEl = el;
      window.clearTimeout(s.hoverTimer);
      if (s.bubble?.sticky) return; // ne pas interrompre un échange en cours
      s.hoverTimer = window.setTimeout(() => {
        if (s.hoverEl !== el || !el.isConnected) return;
        if (s.bubble?.sticky) return; // une bulle ouverte à la demande a été ouverte entre-temps
        show({ kind: "help", text: el.dataset.help ?? "", anchor: el, auto: false, sticky: false });
      }, HOVER_MS);
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget instanceof Element && e.relatedTarget.tagName === "IFRAME") {
        s.overFrame = true;
        kick();
      }
      const el = helpEl(e.target);
      if (!el || el !== s.hoverEl) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      s.hoverEl = null;
      window.clearTimeout(s.hoverTimer);
      const toBot = to instanceof Element && !!to.closest("[data-hl-bot]");
      if (s.bubble?.kind === "help" && !s.bubble.sticky && !toBot) {
        window.clearTimeout(s.closeTimer);
        s.closeTimer = window.setTimeout(() => {
          if (!s.overBubble) close();
        }, 500);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      kick(); // le champ actif détermine la zone à éviter
      if (s.modality !== "keyboard") return;
      const el = helpEl(e.target);
      if (!el || el.closest("[data-hl-bot]") || s.bubble?.sticky) return;
      window.clearTimeout(s.hoverTimer);
      s.hoverTimer = window.setTimeout(() => {
        if (s.bubble?.sticky) return;
        if (document.activeElement && el.contains(document.activeElement)) {
          show({ kind: "help", text: el.dataset.help ?? "", anchor: el, auto: false, sticky: false });
        }
      }, 300);
    };
    const onFocusOut = () => {
      kick();
      if (s.modality === "keyboard" && s.bubble?.kind === "help" && !s.bubble.sticky && !s.overBubble) {
        window.clearTimeout(s.closeTimer);
        s.closeTimer = window.setTimeout(() => {
          if (!bubbleRef.current?.contains(document.activeElement)) close();
        }, 250);
      }
    };

    // --- Activité de l'utilisateur ---
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      s.pointer = { x: e.clientX, y: e.clientY, seen: true };
      s.overFrame = false; // si la page parente reçoit ceci, le curseur n'est plus sur l'iframe
      s.lastActivity = performance.now();
      s.idleFired = false;
      if (
        s.bubble?.auto && !s.overBubble &&
        Math.hypot(e.clientX - s.openPointer.x, e.clientY - s.openPointer.y) > 80
      ) {
        close();
      }
      if (s.mode === "follow") kick();
    };
    const onDown = () => {
      s.modality = "pointer";
      s.lastActivity = performance.now();
      s.idleFired = false;
      s.idleCount = 0; // vraie interaction : les visites guidées repartent de zéro
    };
    const onKey = (e: KeyboardEvent) => {
      s.modality = "keyboard";
      s.lastActivity = performance.now();
      s.idleFired = false;
      s.idleCount = 0;
      if (e.key === "Escape" && s.bubble) close();
    };
    const onLeaveWindow = (e: MouseEvent) => {
      if (e.relatedTarget === null) {
        s.pointer.seen = false;
        kick();
      }
    };
    const onLayout = () => {
      kick();
      if (s.bubble) placeBubble();
    };

    // --- Visite guidée quand l'utilisateur est inactif ---
    const onIdle = () => {
      if (document.hidden || s.bubble || focusedEditable() || s.idleCount >= MAX_IDLE_TIPS) return;
      s.idleCount++;
      const els = visibleHelpEls();
      if (els.length && s.idleCount % 2 === 1) {
        const el = els[s.tourIndex++ % els.length];
        show({ kind: "help", text: el.dataset.help ?? "", anchor: el, auto: true, sticky: false });
      } else {
        const tips = PANEL_TIPS[s.panel];
        show({ kind: "tip", text: tips[s.tipIndex++ % tips.length], anchor: null, auto: true, sticky: false });
      }
    };
    const idleInterval = window.setInterval(() => {
      // Quelqu'un utilise l'aperçu (curseur dessus ou focus dedans) : ce n'est pas de l'inactivité.
      if (s.overFrame || document.activeElement?.tagName === "IFRAME") {
        s.lastActivity = performance.now();
        s.idleFired = false;
        return;
      }
      if (!s.idleFired && performance.now() - s.lastActivity >= IDLE_MS) {
        s.idleFired = true;
        onIdle();
      }
    }, 1000);

    // Ouverture explicite par le bouton « ? » de l'en-tête.
    const onOpenRequest = () => {
      const tips = PANEL_TIPS[s.panel];
      show({
        kind: "tip", text: tips[s.tipIndex++ % tips.length],
        anchor: null, auto: false, sticky: true, focusOnOpen: true,
      });
    };

    // Démarrage
    s.lastActivity = performance.now();
    s.idleFired = false;
    s.pos = corner();
    s.goal = s.pos;
    root.style.transform = `translate3d(${s.pos.x}px, ${s.pos.y}px, 0)`;
    lookAt("pointer");
    kick();

    let welcomeTimer = 0;
    if (!pref.seenWelcome) {
      welcomeTimer = window.setTimeout(() => {
        markWelcomeSeen();
        show({ kind: "welcome", text: WELCOME, anchor: null, auto: false, sticky: false });
      }, 1200);
    }

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("mouseout", onLeaveWindow);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, { capture: true, passive: true });
    window.addEventListener("hlbot:open", onOpenRequest);

    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("mouseout", onLeaveWindow);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("hlbot:open", onOpenRequest);
      window.clearInterval(idleInterval);
      window.clearTimeout(welcomeTimer);
      window.clearTimeout(s.hoverTimer);
      window.clearTimeout(s.closeTimer);
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.lastT = 0;
      s.bubble = null;
      s.anchor = null;
      s.mode = "follow";
      s.covered = false;
      s.shownOnce = false;
      api.current = { close() {}, show() {}, placeBubble() {}, makeSticky() {} };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le mouvement réduit change : on replace le bot (coin ↔ suivi du curseur).
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [reduced]);

  // Changer de mode (Chat/Code/...) ferme la bulle en cours.
  useEffect(() => {
    api.current.close();
  }, [panel]);

  // Replace la bulle quand son contenu change ; focus clavier si ouverte au clavier.
  useEffect(() => {
    if (!bubble) return;
    api.current.placeBubble();
    if (bubble.focusOnOpen) {
      bubbleRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    }
  }, [bubble, askOpen, asking]);

  // ----------------------------- question à l'IA -----------------------------
  const submitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setExpr("thinking");
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          panel,
          hints: visibleHelpEls().map((el) => el.dataset.help ?? "").filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "L'assistant n'a pas pu répondre.");
      setQuestion("");
      setAskOpen(false);
      api.current.show({ kind: "answer", text: data.answer, anchor: null, auto: false, sticky: true });
    } catch (err) {
      setAskOpen(false);
      api.current.show({
        kind: "error",
        text: err instanceof Error ? err.message : "L'assistant n'a pas pu répondre.",
        anchor: null, auto: false, sticky: true,
      });
    } finally {
      setAsking(false);
    }
  };

  const BUBBLE_STYLE: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    visibility: "hidden", // rendu visible une fois positionné
    pointerEvents: "auto",
    width: 292,
    background: "rgba(8, 15, 30, 0.95)",
    border: "1px solid rgba(8, 113, 231, 0.55)",
    boxShadow: "0 0 0 1px rgba(15, 157, 88, 0.15), 0 8px 32px rgba(8, 113, 231, 0.35)",
  };
  const btn =
    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FD0FF]";

  return (
    <>
      {/* Cadre autour de l'élément décrit */}
      <div
        ref={ringRef}
        aria-hidden="true"
        className="pointer-events-none fixed z-[2147482999] rounded-xl"
        style={{
          display: "none",
          left: 0,
          top: 0,
          border: "2px solid #0871E7",
          boxShadow: "0 0 0 3px rgba(8,113,231,.18), 0 0 18px rgba(8,113,231,.45)",
        }}
      />

      <div
        ref={rootRef}
        data-hl-bot=""
        className="pointer-events-none fixed left-0 top-0 z-[2147483000]"
        style={{
          width: BOT,
          height: BOT,
          transform: "translate3d(-200px,-200px,0)",
          willChange: "transform",
        }}
      >
        <div
          ref={visualRef}
          aria-hidden="true"
          style={{ width: BOT, height: BOT, position: "relative", opacity: 0 }}
        >
          {/* Lueur STATIQUE derrière l'avatar. Un drop-shadow CSS sur le SVG animé
              serait re-flouté à chaque image (mesuré : 60 → 12 images/s en rendu
              logiciel) ; un dégradé radial fixe ne coûte presque rien. */}
          <div
            style={{
              position: "absolute",
              inset: -16,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(8,113,231,.50) 0%, rgba(8,113,231,.22) 38%, rgba(15,157,88,.12) 58%, transparent 72%)",
              transform: "translateZ(0)",
            }}
          />
          <div style={{ position: "relative" }}>
            <Blobatar
              ref={gazeRef}
              name="hl-studio"
              size={BOT}
              animate="always"
              background={false}
              expression={EXPRESSIONS[expr]}
              palette={{ head: "#0B1B33", eye: "#8FD0FF" }}
            />
          </div>
        </div>

        {bubble && (
          <div
            ref={bubbleRef}
            data-hl-bot-bubble=""
            role="group"
            aria-label="Assistant HL Studio"
            className="rounded-2xl px-3.5 py-3 text-[13px] leading-snug text-white"
            style={BUBBLE_STYLE}
            onPointerEnter={() => {
              st.current.overBubble = true;
              window.clearTimeout(st.current.closeTimer);
            }}
            onPointerLeave={() => {
              const s = st.current;
              s.overBubble = false;
              if (s.bubble && !s.bubble.sticky) {
                window.clearTimeout(s.closeTimer);
                s.closeTimer = window.setTimeout(() => api.current.close(), 1500);
              }
            }}
          >
            <button
              type="button"
              onClick={() => api.current.close()}
              aria-label="Fermer la bulle d'aide (Échap)"
              className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FD0FF]"
            >
              ✕
            </button>
            <p className="pr-5">{bubble.text}</p>

            {bubble.kind === "answer" && (
              <p className="mt-2 text-[11px] text-white/55">Réponse générée avec ta clé API.</p>
            )}

            {askOpen ? (
              <form onSubmit={submitQuestion} className="mt-2.5 flex flex-col gap-1.5">
                <label htmlFor="hlbot-question" className="sr-only">
                  Ta question à l&apos;assistant
                </label>
                <input
                  id="hlbot-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={300}
                  disabled={asking}
                  autoFocus
                  placeholder="Ta question sur l'interface…"
                  className="w-full rounded-md border border-white/20 bg-white/10 px-2.5 py-1.5 text-xs text-white placeholder-white/40 outline-none focus:border-[#8FD0FF]"
                />
                <p className="text-[11px] text-amber-300/90">
                  Cet envoi utilise ta clé API (coût à ta charge).
                </p>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={asking || !question.trim()}
                    className={`${btn} bg-[#0871E7] text-white hover:bg-[#065CB8] disabled:opacity-50`}
                  >
                    {asking ? "Envoi…" : "Envoyer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAskOpen(false)}
                    className={`${btn} text-white/70 hover:text-white`}
                  >
                    Annuler
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => {
                    api.current.makeSticky();
                    setAskOpen(true);
                  }}
                  className={`${btn} bg-[#0871E7]/90 text-white hover:bg-[#0871E7]`}
                >
                  {bubble.kind === "answer" ? "Autre question" : "Poser une question"}
                </button>
                <button
                  type="button"
                  onClick={() => setBotEnabled(false)}
                  className={`${btn} text-white/70 hover:text-white`}
                >
                  Masquer l&apos;assistant
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Annonce vocale : région live permanente, le texte change quand une bulle s'ouvre */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {bubble ? bubble.text : ""}
      </div>
    </>
  );
}

/** Point d'entrée : rien du tout sur écran tactile ou quand l'utilisateur a masqué le bot. */
export default function HelperBot({ panel }: { panel: WorkspaceMode }) {
  const supported = useBotSupported();
  const { enabled } = useBotPref();
  if (!supported || !enabled) return null;
  return <ActiveBot panel={panel} />;
}
