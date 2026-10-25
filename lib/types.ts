export type WorkspaceMode = "chat" | "code" | "design" | "video";

export const WORKSPACE_MODES: WorkspaceMode[] = ["chat", "code", "design", "video"];

/**
 * Format de l'API d'un fournisseur, pas son nom commercial. La plupart des
 * services (Kimi, GLM, OpenRouter, Together, Groq, Ollama, LM Studio...)
 * exposent le format OpenAI : un seul adaptateur les couvre tous.
 */
export type ProviderProtocol = "openai" | "anthropic" | "gemini";

/** Ce qu'un modèle sait produire. Filtre les modèles proposés par mode. */
export type ModelCapability = "text" | "code" | "image" | "video";

export const MODEL_CAPABILITIES: ModelCapability[] = ["text", "code", "image", "video"];

/** Capacité attendue par chaque mode du studio. */
export const CAPABILITY_BY_MODE: Record<WorkspaceMode, ModelCapability> = {
  chat: "text",
  code: "code",
  design: "image",
  video: "video",
};

export interface ProviderRecord {
  id: string;
  label: string;
  protocol: ProviderProtocol;
  /** Racine de l'API, sans le chemin du endpoint. Ex: https://api.openai.com/v1 */
  baseUrl: string;
  /** Jamais renvoyée par l'API HTTP : voir PublicProvider. */
  apiKey: string;
  createdAt: string;
}

export interface ModelRecord {
  id: string;
  providerId: string;
  /** Identifiant exact attendu par le fournisseur, ex: "gpt-4o-mini". */
  model: string;
  label: string;
  capabilities: ModelCapability[];
  /**
   * Le modèle sait appeler des outils. Le Mode Agent est inutilisable sans,
   * donc l'interface n'affiche que des modèles marqués `true` pour le mode Code.
   */
  supportsTools: boolean;
  createdAt: string;
}

export interface HlPreferences {
  theme: "light" | "dark" | "system";
}

export interface HlIntegrations {
  /**
   * Token GitHub pour l'import et le push de dépôts. Stocké au même
   * endroit que les clés d'IA et soumis aux mêmes règles : jamais renvoyé
   * au navigateur, jamais transmis aux processus enfants.
   */
  githubToken: string;
}

export interface HlConfig {
  version: number;
  providers: ProviderRecord[];
  models: ModelRecord[];
  /** Modèle choisi pour chaque mode. null tant que l'utilisateur n'a rien configuré. */
  assignments: Record<WorkspaceMode, string | null>;
  /** Modèle du bot assistant d'interface. */
  assistantModelId: string | null;
  preferences: HlPreferences;
  integrations: HlIntegrations;
}

/** Vue d'un fournisseur renvoyée au navigateur : sans la clé. */
export type PublicProvider = Omit<ProviderRecord, "apiKey"> & {
  hasApiKey: boolean;
  /** 4 derniers caractères, pour que l'utilisateur reconnaisse sa clé. */
  apiKeyHint: string | null;
};

export type PublicConfig = Omit<HlConfig, "providers" | "integrations"> & {
  providers: PublicProvider[];
  /** Le token lui-même ne sort jamais : seule sa présence est exposée. */
  integrations: { hasGithubToken: boolean };
};

// --- Messages ---------------------------------------------------------

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface GeneratedMedia {
  id: string;
  messageId: string;
  url: string;
  mediaType: "image" | "video";
  createdAt: string;
}

export interface StoredMessage extends ChatMessage {
  id: string;
  conversationId: string;
  modelUsed: string | null;
  createdAt: string;
  media: GeneratedMedia[];
}
