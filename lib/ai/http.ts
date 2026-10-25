import { ProviderError } from "./types";
import type { ProviderRecord } from "@/lib/types";

/** Au-delà, on considère que le fournisseur ne répondra pas. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Combine le signal de l'appelant (client qui ferme l'onglet) et un
 * timeout propre au fournisseur. Sans timeout, une API qui accepte la
 * connexion puis ne renvoie rien bloquerait la requête indéfiniment.
 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export interface ProviderFetchOptions {
  provider: ProviderRecord;
  /** Chemin relatif à baseUrl, commençant par "/". */
  path: string;
  body: unknown;
  headers: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * POST JSON vers un fournisseur, avec un message d'erreur exploitable.
 *
 * Le corps d'erreur du fournisseur est tronqué : certaines API renvoient
 * des pages HTML entières, qui n'apportent rien à l'utilisateur et
 * polluent les logs.
 */
export async function postJson({
  provider,
  path,
  body,
  headers,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ProviderFetchOptions): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: withTimeout(signal, timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ProviderError(
        `${provider.label} n'a pas répondu dans le délai imparti (${Math.round(timeoutMs / 1000)} s).`,
        undefined,
        provider.label
      );
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError("Requête annulée.", undefined, provider.label);
    }
    throw new ProviderError(
      `Impossible de joindre ${provider.label} (${provider.baseUrl}). Vérifie l'URL de l'API et ta connexion.`,
      undefined,
      provider.label
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new ProviderError(
      explainStatus(response.status, provider.label, detail),
      response.status,
      provider.label
    );
  }

  return response;
}

function explainStatus(status: number, label: string, detail: string): string {
  const suffix = detail ? ` — réponse : ${detail}` : "";
  if (status === 401 || status === 403) {
    return `${label} a refusé la clé d'API (${status}). Vérifie la clé dans les Réglages.${suffix}`;
  }
  if (status === 404) {
    return `${label} ne connaît pas ce endpoint (404). L'URL de base est probablement incorrecte.${suffix}`;
  }
  if (status === 429) {
    return `${label} applique une limite de débit (429). Attends un instant ou vérifie ton quota.${suffix}`;
  }
  if (status >= 500) {
    return `${label} rencontre une panne (${status}). Réessaie plus tard.${suffix}`;
  }
  return `${label} a renvoyé une erreur ${status}.${suffix}`;
}

/**
 * Découpe un flux SSE en évènements. Les lignes `data:` d'un même
 * évènement sont concaténées comme le prévoit la spécification, et le
 * tampon n'est vidé que sur une ligne vide : un évènement coupé en deux
 * paquets TCP reste correctement reconstitué.
 */
export async function* parseSse(
  response: Response
): AsyncGenerator<{ event: string | null; data: string }> {
  if (!response.body) {
    throw new ProviderError("Le fournisseur n'a renvoyé aucun flux de données.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // Normaliser les fins de ligne simplifie la détection du séparateur.
      // Un "\r\n" coupé entre deux paquets est recollé au tour suivant, le
      // "\r" isolé restant en fin de tampon.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");

      let separator: number;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        let event: string | null = null;
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (dataLines.length > 0) yield { event, data: dataLines.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
