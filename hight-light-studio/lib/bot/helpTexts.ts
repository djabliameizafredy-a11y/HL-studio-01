import type { WorkspaceMode } from "@/lib/types";

// Tous les textes sont STATIQUES, écrits à l'avance : le bot n'appelle
// jamais l'IA tout seul (chaque appel consommerait la clé de l'utilisateur).
// Les aides par élément se déclarent dans l'interface avec data-help="...".

export const IDLE_MS = 12_000; // inactivité avant une visite guidée
export const BUBBLE_MS = 9_000; // durée d'une bulle qui se ferme seule
export const HOVER_MS = 450; // survol nécessaire avant d'afficher l'aide
export const MAX_IDLE_TIPS = 3; // pas plus de 3 visites sans interaction

export const WELCOME =
  "Salut ! Je suis l'assistant de HL Studio. Survole un élément pour savoir à quoi il sert. Tu peux me masquer à tout moment avec le bouton « Assistant » en haut.";

export const PANEL_TIPS: Record<WorkspaceMode, string[]> = {
  chat: [
    "Tu peux changer de modèle à tout moment avec la liste en haut à droite : chaque mode a sa propre liste.",
    "Appuie sur Entrée pour envoyer ton message.",
    "Les modèles marqués « Free » passent par OpenRouter.",
  ],
  code: [
    "Décris ta tâche en une phrase : l'agent lit, crée et modifie les fichiers de ton workspace.",
    "L'agent te demande ton accord avant d'exécuter une commande, sauf si tu coches l'auto-approbation.",
    "Un fichier HL.md à la racine du workspace donne à l'agent les règles de ton projet.",
    "Tape /nom-du-skill pour lancer une commande personnalisée du dossier .hlstudio/skills.",
  ],
  design: [
    "Décris le visuel voulu : style, couleurs, format.",
    "Le modèle par défaut de ce mode est Nano Banana.",
  ],
  video: [
    "Le modèle vidéo de ce mode est Wan 2.7.",
    "Une description courte et précise est plus facile à interpréter pour le modèle.",
  ],
};
