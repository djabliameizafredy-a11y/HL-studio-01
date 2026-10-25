import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getIsolation } from "@/lib/config/store";
import { mediaDirPath, ensureHlHome } from "@/lib/paths";

/**
 * Automatisation du navigateur, désactivée par défaut.
 *
 * Playwright n'est PAS une dépendance obligatoire : `npx hlstudio` doit
 * démarrer sans Chromium. L'utilisateur active l'option dans Réglages,
 * installe `playwright` + `npx playwright install chromium`, et chaque
 * action reste soumise à confirmation (CONFIRM_TOOLS).
 *
 * Contraintes :
 *  - seules les URL http(s) sont acceptées (pas file://, pas javascript:) ;
 *  - une seule page partagée par processus, fermée après 5 minutes
 *    d'inactivité pour ne pas laisser un Chromium zombie ;
 *  - les captures sont écrites dans ~/.hlstudio/media/ (jamais dans le
 *    workspace, pour ne pas laisser l'agent les relire comme du code).
 */

const INACTIVITY_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

type PlaywrightModule = typeof import("playwright");

let playwrightPromise: Promise<PlaywrightModule> | null = null;
let browser: import("playwright").Browser | null = null;
let page: import("playwright").Page | null = null;
let idleTimer: NodeJS.Timeout | null = null;

function requireEnabled(): void {
  if (!getIsolation().browserEnabled) {
    throw new Error(
      "L'automatisation du navigateur est désactivée. Active-la dans Réglages → Isolation, puis installe Playwright (`npm i -D playwright` et `npx playwright install chromium`)."
    );
  }
}

function assertHttpUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Une URL http(s) est requise.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL invalide : ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Seules les URL http et https sont autorisées.");
  }
  return url.toString();
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  if (!playwrightPromise) {
    playwrightPromise = import("playwright").catch(() => {
      playwrightPromise = null;
      throw new Error(
        "Le module `playwright` n'est pas installé. Lance `npm i -D playwright` puis `npx playwright install chromium`."
      );
    });
  }
  return playwrightPromise;
}

function bumpIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void closeBrowser();
  }, INACTIVITY_MS);
}

async function ensurePage(): Promise<import("playwright").Page> {
  requireEnabled();
  const pw = await loadPlaywright();
  if (!browser || !browser.isConnected()) {
    browser = await pw.chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage"],
    });
    page = null;
  }
  if (!page || page.isClosed()) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: false,
    });
    page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  }
  bumpIdleTimer();
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (page && !page.isClosed()) await page.close().catch(() => {});
  page = null;
  if (browser) await browser.close().catch(() => {});
  browser = null;
}

export type BrowserAction =
  | { action: "open"; url: string }
  | { action: "click"; selector: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "screenshot" }
  | { action: "inspect"; selector?: string }
  | { action: "close" };

function saveScreenshot(buffer: Buffer): string {
  ensureHlHome();
  const dir = mediaDirPath();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `browser-${randomUUID()}.png`;
  const file = path.join(dir, name);
  writeFileSync(file, buffer, { mode: 0o600 });
  return `/api/media/${name}`;
}

export async function executeBrowser(input: BrowserAction): Promise<string> {
  switch (input.action) {
    case "open": {
      const url = assertHttpUrl(input.url);
      const current = await ensurePage();
      await current.goto(url, { waitUntil: "domcontentloaded" });
      return `Page ouverte : ${current.url()} — titre : ${await current.title()}`;
    }
    case "click": {
      if (typeof input.selector !== "string" || !input.selector.trim()) {
        throw new Error("Un sélecteur CSS est requis.");
      }
      const current = await ensurePage();
      await current.click(input.selector);
      return `Clic sur ${input.selector}. URL actuelle : ${current.url()}`;
    }
    case "fill": {
      if (typeof input.selector !== "string" || !input.selector.trim()) {
        throw new Error("Un sélecteur CSS est requis.");
      }
      if (typeof input.value !== "string") {
        throw new Error("Une valeur est requise.");
      }
      const current = await ensurePage();
      await current.fill(input.selector, input.value);
      return `Champ ${input.selector} renseigné.`;
    }
    case "screenshot": {
      const current = await ensurePage();
      const buffer = await current.screenshot({ type: "png", fullPage: false });
      const url = saveScreenshot(buffer);
      return `Capture enregistrée : ${url} (page ${current.url()}).`;
    }
    case "inspect": {
      const current = await ensurePage();
      if (input.selector) {
        const count = await current.locator(input.selector).count();
        if (count === 0) return `Aucun élément ne correspond à ${input.selector}.`;
        const locator = current.locator(input.selector).first();
        const text = (await locator.innerText().catch(() => "")).slice(0, 500);
        const href = await locator.getAttribute("href").catch(() => null);
        return `Trouvé ${count} élément(s). Premier : texte=${JSON.stringify(text)}${href ? ` href=${href}` : ""}`;
      }
      return `URL : ${current.url()}\nTitre : ${await current.title()}`;
    }
    case "close": {
      await closeBrowser();
      return "Navigateur fermé.";
    }
    default:
      throw new Error("Action navigateur inconnue.");
  }
}

export function previewUrl(): string {
  return process.env.NEXT_PUBLIC_PREVIEW_URL ?? "http://localhost:3001";
}
