// Géométrie pure du bot assistant (aucun accès au DOM : testable seule).

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Facteur de lissage indépendant de la fréquence d'images (1 - e^(-dt/tau)). */
export const lerpFactor = (dtMs: number, tauMs: number) =>
  tauMs <= 0 ? 1 : 1 - Math.exp(-dtMs / tauMs);

export const rectFrom = (p: Point, s: Size): Rect => ({
  left: p.x,
  top: p.y,
  right: p.x + s.w,
  bottom: p.y + s.h,
});

export const inflate = (r: Rect, m: number): Rect => ({
  left: r.left - m,
  top: r.top - m,
  right: r.right + m,
  bottom: r.bottom + m,
});

export const intersects = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export const dist2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Garde une boîte (coin haut-gauche) entièrement dans la fenêtre. */
export function clampToViewport(
  p: Point,
  s: Size,
  vw: number,
  vh: number,
  margin = 8
): Point {
  return {
    x: clamp(p.x, margin, Math.max(margin, vw - s.w - margin)),
    y: clamp(p.y, margin, Math.max(margin, vh - s.h - margin)),
  };
}

/**
 * Position du bot quand il suit le curseur : décalé en bas à droite pour ne
 * jamais le recouvrir, et retourné de l'autre côté près des bords.
 */
export function followTarget(
  pointer: Point,
  s: Size,
  vw: number,
  vh: number,
  offset = 26,
  margin = 8
): Point {
  let x = pointer.x + offset;
  let y = pointer.y + offset;
  if (x + s.w > vw - margin) x = pointer.x - offset - s.w;
  if (y + s.h > vh - margin) y = pointer.y - offset - s.h;
  return clampToViewport({ x, y }, s, vw, vh, margin);
}

/**
 * Écarte une boîte des zones interdites (champ de saisie actif...).
 * Renvoie la position la plus proche qui ne recouvre rien, ou null si le
 * recouvrement est inévitable (l'appelant masque alors le bot).
 */
export function avoidRects(
  pos: Point,
  s: Size,
  avoid: Rect[],
  vw: number,
  vh: number,
  margin = 8,
  gap = 10
): Point | null {
  const zones = avoid.map((r) => inflate(r, gap));
  const hits = (p: Point) => zones.some((z) => intersects(rectFrom(p, s), z));
  const start = clampToViewport(pos, s, vw, vh, margin);
  if (!hits(start)) return start;

  const candidates: Point[] = [];
  for (const r of avoid) {
    candidates.push(
      { x: r.right + gap, y: start.y },
      { x: r.left - gap - s.w, y: start.y },
      { x: start.x, y: r.bottom + gap },
      { x: start.x, y: r.top - gap - s.h }
    );
  }
  const valid = candidates
    .map((c) => clampToViewport(c, s, vw, vh, margin))
    .filter((c) => !hits(c))
    .sort((a, b) => dist2(a, start) - dist2(b, start));
  return valid[0] ?? null;
}

/**
 * Place une boîte (bulle, bot) contre un rectangle d'ancrage : dessous,
 * dessus, à droite, à gauche, dans cet ordre. Ne recouvre ni l'ancre ni les
 * zones interdites. Renvoie null si aucun emplacement ne convient.
 */
export function placeBeside(
  anchor: Rect,
  s: Size,
  avoid: Rect[],
  vw: number,
  vh: number,
  margin = 8,
  gap = 10
): Point | null {
  const order: Point[] = [
    { x: anchor.left, y: anchor.bottom + gap },
    { x: anchor.left, y: anchor.top - gap - s.h },
    { x: anchor.right + gap, y: anchor.top },
    { x: anchor.left - gap - s.w, y: anchor.top },
  ];
  for (const c of order) {
    const p = clampToViewport(c, s, vw, vh, margin);
    const box = rectFrom(p, s);
    if (intersects(box, anchor)) continue;
    if (avoid.some((r) => intersects(box, r))) continue;
    return p;
  }
  return null;
}
