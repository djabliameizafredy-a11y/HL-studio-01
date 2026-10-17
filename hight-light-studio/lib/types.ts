export type ModelId = "claude" | "glm-5.2" | "gemma-4" | "nano-banana" | "wan" | "kimi" | "kimi-k3" | "freellmapi" | "gemma-4-free" | "nemotron-free";

export type WorkspaceMode = "chat" | "code" | "design" | "video";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RouteRequestBody {
  messages: ChatMessage[];
  mode?: WorkspaceMode;
  model?: ModelId;
}

export interface ModelResponse {
  provider: ModelId;
  text: string;
  // Pour les modèles image (Nano Banana) — URL ou base64 de l'image générée.
  imageUrl?: string;
  // Pour les modèles vidéo (Wan) — URL de la vidéo générée.
  videoUrl?: string;
}
