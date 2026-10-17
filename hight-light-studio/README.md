# Hight Light Studio

Le workspace IA multi-modèles de Hight Light — chat, code/architecture et
design/images dans une seule interface, avec un routeur qui appelle le bon
modèle IA selon la tâche.

Voir `hight_light_studio_spec.md` (à côté de ce projet) pour l'architecture
complète et la roadmap.

## Démarrage rapide

```bash
npm install
cp .env.example .env.local
# remplis .env.local avec tes clés API
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).

## Statut des intégrations

| Modèle | Fichier | Statut |
|---|---|---|
| Claude (Sonnet 5 / Fable 5 / Opus 4.8) | `lib/providers/claude.ts` | ✅ Fonctionnel (juste besoin de `ANTHROPIC_API_KEY`) |
| GLM-5.2 | `lib/providers/glm.ts` | 🚧 Squelette — vérifier l'endpoint Z.ai avant usage |
| Kimi K2.7-Code | `lib/providers/kimi.ts` | 🚧 Squelette — vérifier l'endpoint Kimi API avant usage |
| Gemma 4 | `lib/providers/gemma.ts` | 🚧 Squelette — vérifier le nom du modèle sur build.nvidia.com |
| Nano Banana | `lib/providers/nanoBanana.ts` | 🚧 Squelette — vérifier le format de réponse Gemini API |
| Wan 2.7 | `lib/providers/wan.ts` | 🚧 Squelette — vérifier l'endpoint Alibaba Model Studio |

**Pour aller plus vite** : au lieu de gérer 3 clés API séparées pour les
modèles open (GLM-5.2, Gemma 4), tu peux passer par
[OpenRouter](https://openrouter.ai), qui héberge ces modèles sous un point
d'entrée unique compatible OpenAI — un seul provider à écrire dans
`lib/providers/` au lieu de deux.

## Structure du projet

```
app/
  api/chat/route.ts   → point d'entrée API, appelle le routeur (Chat/Design/Vidéo)
  api/agent/route.ts   → point d'entrée API du mode agent, réponse streamée
  page.tsx              → page d'accueil
  layout.tsx              → layout racine
lib/
  modelRouter.ts          → décide quel modèle appeler selon le mode
  types.ts                 → types partagés
  providers/                 → un fichier par modèle IA
  agent/
    agentLoop.ts             → boucle plan/action/observation (tool use Claude)
    tools.ts                   → définitions + exécution des outils
    sandbox.ts                  → restriction des chemins au dossier workspace/
components/
  Workspace.tsx                 → shell avec les 4 onglets (Chat/Code/Design/Vidéo)
  ChatPanel.tsx                  → interface de conversation (Chat/Design/Vidéo)
  AgentPanel.tsx                  → interface du mode agent (onglet Code)
workspace/                          → sandbox de l'agent (créé au premier run, ignoré par git)
```

## Mode Agent (Phase 6) — onglet Code

L'onglet **Code** ne fait plus du simple chat : c'est un agent qui lit/écrit
des fichiers et exécute des commandes shell pour accomplir une tâche de
bout en bout, dans l'esprit de Claude Code.

**Comment ça marche** :
- Une boucle plan → action → observation → itération, construite sur le
  tool use de Claude (`lib/agent/agentLoop.ts`)
- 4 outils : `list_files`, `read_file`, `write_file`, `run_command`
  (`lib/agent/tools.ts`)
- Toutes les opérations sont restreintes au dossier `workspace/` à la
  racine du projet (créé automatiquement, ignoré par git)
- Les étapes de l'agent sont streamées en direct vers l'interface

### ⚠️ Sécurité — à lire avant d'aller plus loin

L'agent dispose de deux mécanismes qui exécutent du code arbitraire sur la machine qui fait tourner le serveur : 
1. **`run_command`** : exécute de vraies commandes shell.
2. **Hooks (`workspace/.hlstudio/hooks.json`)** : exécute des scripts à des moments clés (après l'écriture d'un fichier, avant une commande, en début/fin de session).

Les protections actuelles (chemin restreint au workspace, liste de motifs bloqués, timeout) sont un **filet minimal, pas une vraie sandbox** — une liste de blocage se contourne toujours.

- ✅ **OK pour prototyper en local**, sur ta machine, pour toi et ton équipe
- ❌ **Ne jamais exposer `/api/agent` publiquement sans authentification**
- ❌ **Ne pas déployer ce mode tel quel en Phase 7** (ouverture publique) sans remplacer `run_command` et les hooks par un vrai environnement isolé par session (ex: [E2B](https://e2b.dev), un conteneur Docker éphémère, ou une VM Firecracker).

> **Note sur le déploiement (Serverless / Multi-instances) :**  
> Le mécanisme de confirmation humaine pour les outils MCP (Phase 6c) repose actuellement sur une structure de données en mémoire (`pendingConfirmations`). Si l'application est déployée sur un hébergement serverless (comme Vercel) ou multi-instances, ce mécanisme échouera (la requête de confirmation risque d'arriver sur une autre instance, ou la mémoire sera purgée). Pour la production, il faudra utiliser une base de données ou un cache distribué (Redis) pour gérer cet état.

### Tester le mode agent

```bash
npm run dev
```

Va dans l'onglet Code, essaie par exemple : *"Crée un fichier utils.ts
avec une fonction slugify, puis écris un petit script qui la teste."*
Tu verras l'agent explorer, écrire le fichier, l'exécuter, et vérifier le
résultat — en direct.

## Prochaines étapes suggérées

1. Confirmer et brancher les vrais endpoints GLM-5.2, Gemma 4 et Nano Banana
2. Ajouter la persistance des conversations (base de données)
3. Ajouter l'authentification (si le studio devient public un jour)
4. Étoffer le panneau Code (édition de fichiers, exécution) et le panneau
   Design (galerie d'images générées, export)
