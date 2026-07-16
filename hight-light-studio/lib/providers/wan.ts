import type { ChatMessage, ModelResponse } from "@/lib/types";

// Wan (Alibaba) — modèle de génération vidéo, pas à confondre avec Qwen
// (la famille de modèles de langage/multimodaux d'Alibaba, qui COMPREND le
// texte/image/vidéo mais n'en GÉNÈRE pas). Wan est le bon choix pour créer
// des vidéos de landing page, démos produit, ou contenu promotionnel.
//
// Version actuelle : Wan 2.7 (mars 2026). Fonctionnalités clés :
//  - Texte → vidéo, Image → vidéo
//  - Référence → vidéo : uploader un personnage/produit de référence et le
//    faire apparaître dans une nouvelle scène générée (idéal pour montrer
//    un produit Hight Light "en situation" sans tournage réel)
//  - Contrôle de la première/dernière frame pour des transitions précises
//
// Accès : directement via Alibaba Cloud Model Studio, ou via un agrégateur
// (Atlas Cloud, Pixazo) qui expose Wan sous une API unifiée avec Qwen —
// pratique si tu veux aussi utiliser Qwen pour d'autres tâches plus tard.
//
// Doc officielle : https://www.alibabacloud.com/help/en/model-studio

const WAN_API_URL = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"; // à vérifier
const MODEL_NAME = "wan2.7-t2v"; // à vérifier sur Model Studio selon le mode (t2v/i2v/r2v)

export async function callWan(messages: ChatMessage[]): Promise<ModelResponse> {
  if (!process.env.ALIBABA_API_KEY) {
    throw new Error(
      "ALIBABA_API_KEY manquante — ajoute-la dans .env.local (voir lib/providers/wan.ts)"
    );
  }

  const prompt = messages[messages.length - 1]?.content ?? "";

  // La génération vidéo est généralement asynchrone (tâche + polling du
  // résultat) plutôt qu'une réponse immédiate — à adapter une fois
  // l'endpoint exact confirmé dans la doc Model Studio.
  const response = await fetch(WAN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ALIBABA_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      input: { prompt },
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur API Wan : ${response.status}`);
  }

  const data = await response.json();
  const videoUrl = data.output?.video_url ?? data.output?.task_id;

  return {
    provider: "wan",
    text: "Vidéo en cours de génération.",
    videoUrl,
  };
}
