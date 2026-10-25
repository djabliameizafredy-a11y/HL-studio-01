import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveSafePathReal, WORKSPACE_ROOT, ensureWorkspace } from "./sandbox";
import { safeEnv } from "./safeEnv";
import fs from "node:fs/promises";

// ⚠️ SÉCURITÉ — Les hooks exécutent du code arbitraire dans le workspace.
// Même niveau de vigilance que run_command. Ne JAMAIS exposer cette
// fonctionnalité publiquement sans authentification.
// Les hooks restent confinés à workspace/ via resolveSafePath.

const execAsync = promisify(exec);

const HOOKS_CONFIG_PATH = ".hlstudio/hooks.json";
const DEFAULT_HOOK_TIMEOUT = 10_000; // 10 secondes

// Types pour la configuration des hooks
export type HookEvent =
  | "after_file_write"
  | "before_command"
  | "session_start"
  | "session_end";

export interface HookDefinition {
  /** Commande shell à exécuter (ex: "npx prettier --write $FILE_PATH") */
  command: string;
  /** Timeout en millisecondes (défaut: 10000) */
  timeout?: number;
  /** Si true et que le hook échoue, la commande/action est bloquée.
   *  Applicable uniquement à before_command. */
  blocking?: boolean;
}

export interface HooksConfig {
  after_file_write?: HookDefinition[];
  before_command?: HookDefinition[];
  session_start?: HookDefinition[];
  session_end?: HookDefinition[];
}

// Cache de la config pour éviter de relire le fichier à chaque appel
let cachedConfig: HooksConfig | null = null;
let configLoadedAt = 0;
const CONFIG_TTL = 30_000; // Recharger la config toutes les 30s max

/**
 * Charge la configuration des hooks depuis workspace/.hlstudio/hooks.json.
 * Retourne un objet vide si le fichier n'existe pas ou est invalide.
 */
export async function loadHooksConfig(): Promise<HooksConfig> {
  const now = Date.now();
  if (cachedConfig && now - configLoadedAt < CONFIG_TTL) {
    return cachedConfig;
  }

  try {
    await ensureWorkspace();
    const configPath = await resolveSafePathReal(HOOKS_CONFIG_PATH);
    const raw = await fs.readFile(configPath, "utf-8");
    cachedConfig = JSON.parse(raw) as HooksConfig;
    configLoadedAt = now;
    return cachedConfig;
  } catch {
    // Fichier introuvable ou JSON invalide — pas de hooks configurés
    cachedConfig = {};
    configLoadedAt = now;
    return cachedConfig;
  }
}

/** Invalide le cache des hooks (utile après un write_file sur hooks.json) */
export function invalidateHooksCache(): void {
  cachedConfig = null;
  configLoadedAt = 0;
}

/**
 * Résultat de l'exécution d'un hook.
 */
export interface HookResult {
  command: string;
  success: boolean;
  output: string;
  blocked: boolean; // true si before_command a explicitement bloqué
}

/**
 * Exécute tous les hooks définis pour un événement donné.
 *
 * @param event - Type d'événement (after_file_write, before_command, etc.)
 * @param envVars - Variables d'environnement supplémentaires passées au script
 *                  (ex: { FILE_PATH: "src/index.ts" })
 * @returns Tableau de résultats. Pour before_command, vérifier `blocked`.
 *
 * Comportement selon l'événement :
 * - after_file_write : erreur logguée, n'interrompt jamais l'agent
 * - before_command : si un hook `blocking: true` échoue, renvoie blocked=true
 * - session_start / session_end : erreur logguée, jamais bloquant
 */
export async function executeHooks(
  event: HookEvent,
  envVars: Record<string, string> = {}
): Promise<HookResult[]> {
  const config = await loadHooksConfig();
  const hooks = config[event];

  if (!hooks || hooks.length === 0) return [];

  const results: HookResult[] = [];

  for (const hook of hooks) {
    const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT;

    // La commande utilise les variables d'environnement passées à execAsync
    // Le shell se chargera de l'interpolation (ex: echo $FILE_PATH)
    const command = hook.command;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: WORKSPACE_ROOT,
        timeout,
        maxBuffer: 512 * 1024,
        env: safeEnv({
          ...envVars,
          WORKSPACE_ROOT,
        }),
      });

      results.push({
        command: hook.command,
        success: true,
        output: (stdout + stderr).trim(),
        blocked: false,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isBlocking = event === "before_command" && hook.blocking === true;

      results.push({
        command: hook.command,
        success: false,
        output: errMsg,
        blocked: isBlocking,
      });

      // Seul before_command avec blocking=true arrête l'itération
      if (isBlocking) break;

      // Les autres événements : logguer et continuer
      console.warn(
        `[hooks] Erreur sur hook "${event}" (${hook.command}) : ${errMsg}`
      );
    }
  }

  return results;
}
