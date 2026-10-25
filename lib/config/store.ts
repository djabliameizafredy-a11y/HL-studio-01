import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { configFilePath, writeSecretFileSync } from "@/lib/paths";
import {
  CAPABILITY_BY_MODE,
  MODEL_CAPABILITIES,
  WORKSPACE_MODES,
  type HlConfig,
  type ModelCapability,
  type ModelRecord,
  type ProviderProtocol,
  type ProviderRecord,
  type PublicConfig,
  type PublicProvider,
  type WorkspaceMode,
} from "@/lib/types";

const CONFIG_VERSION = 1;

const PROTOCOLS: ProviderProtocol[] = ["openai", "anthropic", "gemini"];

/** Erreur de validation d'une entrée utilisateur — devient un HTTP 400. */
export class ConfigValidationError extends Error {}

function emptyConfig(): HlConfig {
  return {
    version: CONFIG_VERSION,
    providers: [],
    models: [],
    assignments: { chat: null, code: null, design: null, video: null },
    assistantModelId: null,
    preferences: { theme: "system" },
    integrations: { githubToken: "" },
  };
}

// Le fichier est minuscule mais lu à chaque requête API. On le garde en
// mémoire et on le relit uniquement si son mtime a changé — ce qui permet
// aussi à l'utilisateur d'éditer config.json à la main sans redémarrer.
let cache: { config: HlConfig; mtimeMs: number } | null = null;

function parseConfig(raw: string): HlConfig {
  const parsed = JSON.parse(raw) as Partial<HlConfig>;
  const base = emptyConfig();

  const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
  const models = Array.isArray(parsed.models) ? parsed.models : [];

  const assignments = { ...base.assignments };
  for (const mode of WORKSPACE_MODES) {
    const value = parsed.assignments?.[mode];
    assignments[mode] = typeof value === "string" ? value : null;
  }

  return {
    version: typeof parsed.version === "number" ? parsed.version : CONFIG_VERSION,
    providers,
    models,
    assignments,
    assistantModelId:
      typeof parsed.assistantModelId === "string" ? parsed.assistantModelId : null,
    preferences: {
      theme: parsed.preferences?.theme ?? "system",
    },
    integrations: {
      githubToken:
        typeof parsed.integrations?.githubToken === "string"
          ? parsed.integrations.githubToken
          : "",
    },
  };
}

export function readConfig(): HlConfig {
  const file = configFilePath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    // Premier lancement : pas encore de fichier, on part d'une config vide
    // sans l'écrire (inutile de créer un fichier tant qu'il est vide).
    cache = null;
    return emptyConfig();
  }

  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.config;

  try {
    const config = parseConfig(fs.readFileSync(file, "utf-8"));
    cache = { config, mtimeMs: stat.mtimeMs };
    return config;
  } catch (err) {
    // JSON corrompu : on ne l'écrase surtout pas (il contient les clés de
    // l'utilisateur), on remonte une erreur explicite.
    throw new Error(
      `Le fichier de configuration ${file} est illisible (${
        err instanceof Error ? err.message : "JSON invalide"
      }). Corrige-le ou renomme-le pour repartir d'une configuration vide.`
    );
  }
}

export function writeConfig(config: HlConfig): HlConfig {
  const file = configFilePath();
  writeSecretFileSync(file, JSON.stringify(config, null, 2) + "\n");
  cache = { config, mtimeMs: fs.statSync(file).mtimeMs };
  return config;
}

function mutate(fn: (config: HlConfig) => void): HlConfig {
  const config = structuredClone(readConfig());
  fn(config);
  return writeConfig(config);
}

// --- Vue publique -----------------------------------------------------

function toPublicProvider(provider: ProviderRecord): PublicProvider {
  const { apiKey, ...rest } = provider;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyHint: apiKey ? apiKey.slice(-4) : null,
  };
}

/**
 * Config débarrassée des clés d'API, seule forme autorisée à sortir par
 * HTTP. Le navigateur n'a jamais besoin des clés : tous les appels aux
 * fournisseurs partent du serveur local.
 */
export function readPublicConfig(): PublicConfig {
  const { integrations, ...config } = readConfig();
  return {
    ...config,
    providers: config.providers.map(toPublicProvider),
    integrations: { hasGithubToken: Boolean(integrations.githubToken) },
  };
}

// --- Validation -------------------------------------------------------

function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConfigValidationError(`Le champ "${field}" est requis.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ConfigValidationError(
      `Le champ "${field}" dépasse ${max} caractères.`
    );
  }
  return trimmed;
}

/**
 * Valide l'URL d'un fournisseur. http n'est accepté que vers la machine
 * locale : une clé d'API envoyée en clair sur le réseau est interceptable,
 * mais on doit rester compatible avec Ollama ou LM Studio en localhost.
 */
function requireBaseUrl(value: unknown): string {
  const raw = requireString(value, "baseUrl", 500);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigValidationError(
      "L'URL de l'API est invalide (exemple attendu : https://api.openai.com/v1)."
    );
  }
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new ConfigValidationError(
      "L'URL doit être en https (http n'est autorisé que vers localhost)."
    );
  }
  return raw.replace(/\/+$/, "");
}

function requireProtocol(value: unknown): ProviderProtocol {
  if (typeof value !== "string" || !PROTOCOLS.includes(value as ProviderProtocol)) {
    throw new ConfigValidationError(
      `Protocole inconnu. Valeurs acceptées : ${PROTOCOLS.join(", ")}.`
    );
  }
  return value as ProviderProtocol;
}

function requireCapabilities(value: unknown): ModelCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigValidationError(
      "Indique au moins une capacité pour ce modèle (texte, code, image ou vidéo)."
    );
  }
  const unknown = value.find(
    (c) => typeof c !== "string" || !MODEL_CAPABILITIES.includes(c as ModelCapability)
  );
  if (unknown !== undefined) {
    throw new ConfigValidationError(
      `Capacité inconnue : ${String(unknown)}. Valeurs acceptées : ${MODEL_CAPABILITIES.join(", ")}.`
    );
  }
  return Array.from(new Set(value as ModelCapability[]));
}

// --- Fournisseurs -----------------------------------------------------

export interface ProviderInput {
  label?: unknown;
  protocol?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
}

export function addProvider(input: ProviderInput): PublicProvider {
  const provider: ProviderRecord = {
    id: randomUUID(),
    label: requireString(input.label, "label"),
    protocol: requireProtocol(input.protocol),
    baseUrl: requireBaseUrl(input.baseUrl),
    apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : "",
    createdAt: new Date().toISOString(),
  };
  mutate((config) => {
    config.providers.push(provider);
  });
  return toPublicProvider(provider);
}

export function updateProvider(id: string, input: ProviderInput): PublicProvider {
  let updated: ProviderRecord | null = null;
  mutate((config) => {
    const provider = config.providers.find((p) => p.id === id);
    if (!provider) throw new ConfigValidationError("Fournisseur introuvable.");

    if (input.label !== undefined) provider.label = requireString(input.label, "label");
    if (input.protocol !== undefined) provider.protocol = requireProtocol(input.protocol);
    if (input.baseUrl !== undefined) provider.baseUrl = requireBaseUrl(input.baseUrl);
    // Chaîne vide = « ne touche pas à la clé existante ». Pour effacer une
    // clé, l'utilisateur supprime le fournisseur.
    if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      provider.apiKey = input.apiKey.trim();
    }
    updated = provider;
  });
  return toPublicProvider(updated!);
}

export function deleteProvider(id: string): void {
  mutate((config) => {
    const index = config.providers.findIndex((p) => p.id === id);
    if (index === -1) throw new ConfigValidationError("Fournisseur introuvable.");
    config.providers.splice(index, 1);

    // Les modèles d'un fournisseur supprimé n'ont plus de clé : on les
    // retire aussi, et on libère les modes qui pointaient dessus pour ne
    // pas laisser l'interface sur un modèle fantôme.
    const orphans = new Set(
      config.models.filter((m) => m.providerId === id).map((m) => m.id)
    );
    config.models = config.models.filter((m) => !orphans.has(m.id));
    for (const mode of WORKSPACE_MODES) {
      if (config.assignments[mode] && orphans.has(config.assignments[mode]!)) {
        config.assignments[mode] = null;
      }
    }
    if (config.assistantModelId && orphans.has(config.assistantModelId)) {
      config.assistantModelId = null;
    }
  });
}

// --- Modèles ----------------------------------------------------------

export interface ModelInput {
  providerId?: unknown;
  model?: unknown;
  label?: unknown;
  capabilities?: unknown;
  supportsTools?: unknown;
}

export function addModel(input: ModelInput): ModelRecord {
  const record: ModelRecord = {
    id: randomUUID(),
    providerId: requireString(input.providerId, "providerId"),
    model: requireString(input.model, "model"),
    label: "",
    capabilities: requireCapabilities(input.capabilities),
    supportsTools: input.supportsTools === true,
    createdAt: new Date().toISOString(),
  };
  record.label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim()
      : record.model;

  mutate((config) => {
    if (!config.providers.some((p) => p.id === record.providerId)) {
      throw new ConfigValidationError("Fournisseur introuvable pour ce modèle.");
    }
    config.models.push(record);
  });
  return record;
}

export function updateModel(id: string, input: ModelInput): ModelRecord {
  let updated: ModelRecord | null = null;
  mutate((config) => {
    const model = config.models.find((m) => m.id === id);
    if (!model) throw new ConfigValidationError("Modèle introuvable.");

    if (input.model !== undefined) model.model = requireString(input.model, "model");
    if (input.label !== undefined) model.label = requireString(input.label, "label");
    if (input.capabilities !== undefined) {
      model.capabilities = requireCapabilities(input.capabilities);
    }
    if (input.supportsTools !== undefined) {
      model.supportsTools = input.supportsTools === true;
    }
    updated = model;
  });
  return updated!;
}

export function deleteModel(id: string): void {
  mutate((config) => {
    const index = config.models.findIndex((m) => m.id === id);
    if (index === -1) throw new ConfigValidationError("Modèle introuvable.");
    config.models.splice(index, 1);
    for (const mode of WORKSPACE_MODES) {
      if (config.assignments[mode] === id) config.assignments[mode] = null;
    }
    if (config.assistantModelId === id) config.assistantModelId = null;
  });
}

// --- Assignation par mode ---------------------------------------------

export function setAssignment(mode: WorkspaceMode, modelId: string | null): void {
  mutate((config) => {
    if (modelId === null) {
      config.assignments[mode] = null;
      return;
    }
    const model = config.models.find((m) => m.id === modelId);
    if (!model) throw new ConfigValidationError("Modèle introuvable.");

    // Empêche de choisir un modèle vidéo pour le Chat, ou un modèle texte
    // pour le Design : l'appel échouerait côté fournisseur, avec un message
    // d'erreur bien moins clair.
    const needed = CAPABILITY_BY_MODE[mode];
    if (!model.capabilities.includes(needed)) {
      throw new ConfigValidationError(
        `Le modèle "${model.label}" ne déclare pas la capacité "${needed}", requise par le mode ${mode}.`
      );
    }
    if (mode === "code" && !model.supportsTools) {
      throw new ConfigValidationError(
        `Le mode Code a besoin d'un modèle capable d'appeler des outils. Coche "supportsTools" sur "${model.label}" si son API le permet.`
      );
    }
    config.assignments[mode] = modelId;
  });
}

export function setAssistantModel(modelId: string | null): void {
  mutate((config) => {
    if (modelId !== null && !config.models.some((m) => m.id === modelId)) {
      throw new ConfigValidationError("Modèle introuvable.");
    }
    config.assistantModelId = modelId;
  });
}

/**
 * Enregistre ou efface le token GitHub. Une chaîne vide efface, à la
 * différence des clés de fournisseurs : ici l'utilisateur n'a pas d'autre
 * moyen de retirer le token sans éditer le fichier à la main.
 */
export function setGithubToken(token: unknown): void {
  if (typeof token !== "string") {
    throw new ConfigValidationError("Le token doit être une chaîne de caractères.");
  }
  mutate((config) => {
    config.integrations.githubToken = token.trim();
  });
}

export function setPreferences(input: { theme?: unknown }): void {
  mutate((config) => {
    if (input.theme !== undefined) {
      if (!["light", "dark", "system"].includes(String(input.theme))) {
        throw new ConfigValidationError("Thème invalide.");
      }
      config.preferences.theme = input.theme as HlConfig["preferences"]["theme"];
    }
  });
}

// --- Résolution à l'exécution -----------------------------------------

export interface ResolvedModel {
  provider: ProviderRecord;
  model: ModelRecord;
}

/** Retrouve un modèle et son fournisseur (clé comprise) par identifiant. */
export function resolveModelById(modelId: string): ResolvedModel {
  const config = readConfig();
  const model = config.models.find((m) => m.id === modelId);
  if (!model) {
    throw new ConfigValidationError(
      "Ce modèle n'existe plus dans ta configuration. Choisis-en un autre dans les Réglages."
    );
  }
  const provider = config.providers.find((p) => p.id === model.providerId);
  if (!provider) {
    throw new ConfigValidationError(
      `Le fournisseur du modèle "${model.label}" a été supprimé. Reconfigure-le dans les Réglages.`
    );
  }
  if (!provider.apiKey) {
    throw new ConfigValidationError(
      `Aucune clé d'API enregistrée pour "${provider.label}". Ajoute-la dans les Réglages.`
    );
  }
  return { provider, model };
}

/**
 * Modèle d'un mode. `override` permet au client de choisir ponctuellement
 * un autre modèle (sélecteur de l'en-tête) sans modifier la config, mais
 * il est toujours revalidé ici : le navigateur n'est pas une source de
 * confiance pour décider quel modèle a le droit de tourner.
 */
export function resolveModelForMode(
  mode: WorkspaceMode,
  override?: string | null
): ResolvedModel {
  const config = readConfig();
  const modelId = override ?? config.assignments[mode];
  if (!modelId) {
    throw new ConfigValidationError(
      `Aucun modèle n'est configuré pour le mode ${mode}. Ouvre les Réglages pour en associer un.`
    );
  }
  const resolved = resolveModelById(modelId);
  const needed = CAPABILITY_BY_MODE[mode];
  if (!resolved.model.capabilities.includes(needed)) {
    throw new ConfigValidationError(
      `Le modèle "${resolved.model.label}" ne gère pas "${needed}", requis par le mode ${mode}.`
    );
  }
  return resolved;
}

export function resolveAssistantModel(): ResolvedModel {
  const config = readConfig();
  if (!config.assistantModelId) {
    throw new ConfigValidationError(
      "Aucun modèle n'est associé au bot assistant. Choisis-en un dans les Réglages."
    );
  }
  return resolveModelById(config.assistantModelId);
}
