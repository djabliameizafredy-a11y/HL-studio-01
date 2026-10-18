import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------
// Garde-fou de TOUTES les routes /api/* (HL Studio tourne en local).
//
// Menace : n'importe quel site web ouvert dans le navigateur de
// l'utilisateur peut envoyer des requêtes à http://localhost:<port>.
//   - CSRF : un POST "simple" (text/plain, multipart) part sans
//     préflight CORS et serait exécuté par le serveur (ex: lancer
//     l'agent, qui exécute des commandes shell).
//   - DNS rebinding : un domaine attaquant qui résout vers 127.0.0.1
//     peut LIRE les réponses, car le navigateur le croit same-origin.
//
// Défenses (standard pour les outils locaux, ex: Jupyter) :
//   1. Host doit être localhost / 127.0.0.1 / [::1]  → bloque le rebinding
//   2. Origin, s'il est présent, doit être exactement notre origine
//   3. Sec-Fetch-Site doit être same-origin (ou absent : curl, scripts)
//      → bloque aussi l'app générée servie sur un autre port (même
//      "same-site", mais pas same-origin) : elle ne doit jamais pouvoir
//      appeler /api/config, /api/agent, etc.
//   4. Requêtes avec corps : Content-Type JSON ou multipart uniquement
//
// Les clients non-navigateur (curl, CI) n'envoient pas Origin ni
// Sec-Fetch-Site et restent donc fonctionnels en local.
//
// Hébergement derrière un autre nom d'hôte : HLSTUDIO_ALLOWED_HOSTS
// (liste séparée par des virgules). À n'utiliser qu'avec une clé API.
// ---------------------------------------------------------------------

const DEFAULT_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function allowedHosts(): Set<string> {
  const extra = (process.env.HLSTUDIO_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_HOSTS, ...extra]);
}

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1); // IPv6
  return h.split(":")[0];
}

function forbid(status: number, error: string) {
  return new NextResponse(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function middleware(req: NextRequest) {
  const hostHeader = req.headers.get("host") ?? "";

  if (!allowedHosts().has(hostnameOf(hostHeader))) {
    return forbid(403, "Hôte non autorisé.");
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return forbid(403, "Origine invalide.");
    }
    if (originHost !== hostHeader.trim().toLowerCase()) {
      return forbid(403, "Origine non autorisée.");
    }
  }

  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return forbid(403, "Requête inter-sites refusée.");
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("application/json") && !ct.startsWith("multipart/form-data")) {
      return forbid(415, "Content-Type application/json requis.");
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = { matcher: "/api/:path*" };
