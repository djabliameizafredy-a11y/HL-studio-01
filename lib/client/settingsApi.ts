import type {
  IsolationMode,
  ModelCapability,
  ModelRecord,
  ProviderProtocol,
  PublicConfig,
  PublicProvider,
  WorkspaceMode,
} from "@/lib/types";

/**
 * Appels HTTP des Réglages. Toutes les réponses d'erreur du serveur
 * portent un champ `error` déjà rédigé pour l'utilisateur : on le remonte
 * tel quel plutôt que d'inventer un message côté client.
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string }).error ?? `Erreur HTTP ${res.status}`);
  }
  return payload as T;
}

export const fetchConfig = () => request<PublicConfig>("/api/settings");

export interface ProviderFormValues {
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
}

export const createProvider = (values: ProviderFormValues) =>
  request<PublicProvider>("/api/settings/providers", {
    method: "POST",
    body: JSON.stringify(values),
  });

export const patchProvider = (id: string, values: Partial<ProviderFormValues>) =>
  request<PublicProvider>(`/api/settings/providers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });

export const removeProvider = (id: string) =>
  request<{ ok: true }>(`/api/settings/providers/${id}`, { method: "DELETE" });

export interface ModelFormValues {
  providerId: string;
  model: string;
  label: string;
  capabilities: ModelCapability[];
  supportsTools: boolean;
}

export const createModel = (values: ModelFormValues) =>
  request<ModelRecord>("/api/settings/models", {
    method: "POST",
    body: JSON.stringify(values),
  });

export const removeModel = (id: string) =>
  request<{ ok: true }>(`/api/settings/models/${id}`, { method: "DELETE" });

export interface SettingsPatch {
  assignments?: Partial<Record<WorkspaceMode, string | null>>;
  assistantModelId?: string | null;
  githubToken?: string;
  preferences?: { theme?: string };
  isolation?: { mode?: IsolationMode; browserEnabled?: boolean };
}

export const patchSettings = (patch: SettingsPatch) =>
  request<PublicConfig>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export interface ModelTestResult {
  ok: boolean;
  message: string;
  checks: { name: string; ok: boolean; detail: string }[];
}

export const testModelById = (modelId: string) =>
  request<ModelTestResult>("/api/settings/test", {
    method: "POST",
    body: JSON.stringify({ modelId }),
  });
