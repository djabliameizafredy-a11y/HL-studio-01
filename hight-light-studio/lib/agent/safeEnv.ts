// ---------------------------------------------------------------------
// Environnement transmis aux processus lancés par l'agent (run_command,
// hooks, git). Par défaut un processus enfant hérite de TOUT process.env,
// y compris ANTHROPIC_API_KEY, GITHUB_TOKEN, etc. : un simple `env` ou
// `echo $ANTHROPIC_API_KEY` (ou une injection de prompt qui le demande)
// ferait entrer la clé dans le contexte du modèle et dans les logs.
//
// ⚠️ Limite honnête : ce filtre protège contre la fuite accidentelle ou
// triviale des variables. Il ne protège PAS les secrets stockés dans des
// fichiers (.env.local, ~/.hlstudio/config.json) : un shell peut les lire.
// La vraie frontière, c'est la confirmation humaine avant chaque commande
// (voir CONFIRM_TOOLS dans agentLoop.ts).
// ---------------------------------------------------------------------

const SENSITIVE_NAME =
  /(API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|COOKIE|_KEY$|(^|_)AUTH(_|$))/i;

const SENSITIVE_EXACT = new Set([
  "ANTHROPIC_API_KEY",
  "ZAI_API_KEY",
  "NVIDIA_API_KEY",
  "GEMINI_API_KEY",
  "KIMI_API_KEY",
  "ALIBABA_API_KEY",
  "OPENROUTER_API_KEY",
  "GITHUB_TOKEN",
  "HL_AGENT_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_EXACT.has(name) || SENSITIVE_NAME.test(name);
}

/**
 * Copie de process.env sans les variables sensibles. `extra` est ajouté
 * APRÈS le filtrage : ce que l'on passe explicitement (config d'un
 * serveur MCP, variables d'un hook) est un choix délibéré de l'utilisateur.
 */
export function safeEnv(
  extra: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  const out = {} as NodeJS.ProcessEnv; // (les types Next rendent NODE_ENV obligatoire)
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || isSensitiveEnvName(k)) continue;
    out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
