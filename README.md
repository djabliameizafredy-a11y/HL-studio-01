# HL Studio

**HL Studio** (*Hight Light Studio*) est un studio d'intelligence artificielle
qui tourne **en local sur ta machine**. Il réunit quatre espaces de travail —
Chat, Code, Design et Vidéo — dans une seule interface web.

Deux principes guident le projet :

- **Local-first** : l'application se lance avec `npx hlstudio` et sert une page
  sur `localhost`. Aucun compte, aucun abonnement, aucun serveur distant
  obligatoire. Tes conversations et tes réglages restent dans
  `~/.hlstudio` sur ton disque.
- **BYOK — Bring Your Own Key** : tu déclares tes propres fournisseurs d'IA et
  tes propres clés d'API. Aucun modèle n'est imposé par le code.

---

## Prérequis

| Outil | Version | Pourquoi |
|---|---|---|
| Node.js | **22.5 minimum**, 24 recommandé | HL Studio stocke ses données avec le module `node:sqlite` intégré à Node. Aucun module natif à compiler. |
| Git | n'importe laquelle | Nécessaire pour l'import/export GitHub et les outils Git du Mode Agent. |

Sur Node 22.5 à 23.3, le module SQLite est encore expérimental : le lanceur
ajoute l'option nécessaire tout seul, tu n'as rien à faire.

## Installation

```bash
npx hlstudio
```

Le lanceur choisit un port libre, démarre le serveur et ouvre ton navigateur.

```bash
npx hlstudio --port 3210                 # port imposé
npx hlstudio --workspace ~/mes-projets   # dossier de travail de l'agent
```

### Depuis les sources

```bash
git clone https://github.com/djabliameizafredy-a11y/HL-studio-01.git
cd HL-studio-01
npm install
npm run dev          # http://localhost:3000
```

---

## Configuration initiale

Au premier lancement, aucun modèle n'est configuré : les panneaux affichent un
bandeau qui renvoie vers les **Réglages** (icône engrenage, en haut à droite).

### 1. Ajouter un fournisseur d'IA

Onglet **Fournisseurs** → *Ajouter*. Un fournisseur, c'est une URL d'API, un
protocole et une clé.

| Protocole | À choisir pour | URL de base type |
|---|---|---|
| `openai` | OpenAI, Kimi, GLM, OpenRouter, Groq, Together, Mistral, Ollama, LM Studio… | `https://api.openai.com/v1` |
| `anthropic` | Claude | `https://api.anthropic.com/v1` |
| `gemini` | Gemini, Imagen, Veo | `https://generativelanguage.googleapis.com/v1beta` |

Le protocole décrit le **format de l'API**, pas la marque. La grande majorité
des services annoncent une « compatibilité OpenAI » : choisis `openai` et
remplace simplement l'URL de base.

### 2. Déclarer un modèle

Onglet **Modèles** → *Ajouter*. Renseigne l'identifiant **exact** attendu par
le fournisseur (par exemple `gpt-4o-mini`), puis coche ce que le modèle sait
faire :

- **Texte** — mode Chat
- **Code** — Mode Agent
- **Image** — mode Design
- **Vidéo** — mode Vidéo
- **Sait appeler des outils** — obligatoire pour le Mode Agent

Le bouton **Tester** envoie un message minimal pour vérifier la clé, et, si tu
as coché le support des outils, un appel d'outil réel pour confirmer que le
modèle en est capable.

### 3. Associer un modèle à chaque mode

Onglet **Modes**. Chaque mode ne propose que les modèles compatibles : tu ne
peux pas sélectionner un modèle vidéo pour le Chat. Le sélecteur de l'en-tête
permet ensuite de changer ponctuellement de modèle sans toucher aux réglages.

---

## Où sont stockées tes données

Tout vit dans `~/.hlstudio` (ou dans le dossier indiqué par `HLSTUDIO_HOME`) :

| Chemin | Contenu |
|---|---|
| `~/.hlstudio/config.json` | Fournisseurs, modèles, clés d'API, token GitHub. Créé en `0600`. |
| `~/.hlstudio/hlstudio.db` | Conversations, messages, historique (SQLite). |
| `~/.hlstudio/media/` | Images et vidéos générées. |
| `~/.hlstudio/workspace/` | Dossier de travail de l'agent, par défaut. |

Ce dossier est **hors du répertoire d'installation** : une mise à jour de
`npx hlstudio` ne touche pas à tes données.

> Les clés d'API ne sont jamais envoyées au navigateur. L'API des réglages ne
> renvoie que les 4 derniers caractères d'une clé, à titre de repère visuel.

---

## Mode Agent (onglet Code)

L'onglet Code n'est pas un chat : c'est un agent qui lit et écrit des fichiers
et exécute des commandes pour accomplir une tâche de bout en bout.

**Outils disponibles** : `list_files`, `read_file`, `write_file`,
`run_command`, `git_create_branch`, `git_diff`, `git_create_pr`, plus tous les
outils exposés par tes serveurs MCP.

### Mémoire de projet — `HL.md`

Si un fichier `HL.md` existe à la racine du workspace, son contenu est ajouté
au prompt système de chaque session. C'est l'endroit où décrire les
conventions du projet, l'architecture et ce qu'il ne faut pas toucher.

### Skills — commandes personnalisées

Un fichier `<workspace>/.hlstudio/skills/review-security.md` crée la commande
`/review-security`. Tape-la dans le champ de tâche et son contenu devient les
instructions de l'agent.

```
/review-security les routes d'upload
```

### Hooks

`<workspace>/.hlstudio/hooks.json` déclenche des scripts à des moments précis :

```json
{
  "after_file_write": [{ "command": "npx prettier --write $FILE_PATH" }],
  "before_command": [{ "command": "./scripts/guard.sh", "blocking": true }],
  "session_start": [{ "command": "git status --short" }]
}
```

Un hook `before_command` en `blocking: true` qui échoue annule la commande.

### Sous-agents parallèles

L'API accepte un tableau `parallel` pour lancer jusqu'à trois sous-agents
spécialisés en même temps, puis produire une synthèse de leurs résultats. Les
sous-agents travaillent en **lecture seule** : ni écriture, ni commande, ni
outil MCP.

---

## Serveurs MCP

`<workspace>/.hlstudio/mcp.json` connecte HL Studio à des services externes
(GitHub, PostgreSQL, Figma…) :

```json
{
  "servers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ton-token" }
    }
  }
}
```

Deux règles non négociables :

1. **Chaque appel d'un outil MCP demande une confirmation explicite**, même
   quand l'auto-approbation des commandes est activée.
2. Les serveurs MCP ne reçoivent **que** les variables déclarées dans leur
   bloc `env` — jamais l'environnement complet, qui contiendrait tes clés.

L'agent ne peut pas écrire `mcp.json` ni `hooks.json` lui-même : ces fichiers
déclenchent de l'exécution de code. Une tentative d'écriture crée un fichier
`.proposed` que tu dois renommer à la main.

---

## Sécurité

Ce qui est en place :

- **Bac à sable de fichiers** — toutes les opérations sont confinées au
  workspace. Les chemins sont vérifiés en texte *et* après résolution des
  liens symboliques, y compris pour les fichiers qui n'existent pas encore.
- **Confirmation humaine** — `run_command`, les opérations Git et tous les
  outils MCP demandent ton accord. Une demande sans réponse expire au bout de
  5 minutes.
- **Confirmations liées à la session** — une confirmation ne peut pas être
  utilisée par une autre session.
- **Filtrage des variables d'environnement** — les processus lancés par
  l'agent n'héritent d'aucune variable ressemblant à une clé ou à un token.
- **Protection du serveur local** — toutes les routes `/api/*` vérifient
  l'en-tête `Host`, l'`Origin` et `Sec-Fetch-Site`, ce qui bloque le CSRF
  depuis un autre site et le DNS rebinding.
- **Token GitHub jamais dans une URL** — il passe par un en-tête HTTP, donc
  il n'apparaît ni dans `ps`, ni dans les logs de Git, ni dans `.git/config`.
- **Archives vérifiées entrée par entrée** — un `.zip` contenant des chemins
  `../..` voit ces entrées refusées (« zip slip »).

Ce qui ne l'est pas encore — lis cette partie avant de dépasser un usage
personnel :

- `run_command` repose sur une **liste de motifs interdits**, pas sur une vraie
  isolation. Une liste de blocage se contourne toujours. L'isolation renforcée
  (OpenSandbox / conteneur éphémère) est le prochain chantier.
- **N'expose jamais HL Studio sur un réseau public.** Si tu dois l'héberger
  derrière un autre nom d'hôte, renseigne `HLSTUDIO_ALLOWED_HOSTS` *et* une clé
  `HL_AGENT_API_KEY`.
- Les confirmations MCP vivent en mémoire du processus : un déploiement
  multi-instances ou serverless les perdrait.

---

## Variables d'environnement

Aucune n'est obligatoire : tout se configure depuis l'interface.

| Variable | Rôle |
|---|---|
| `HLSTUDIO_HOME` | Déplace le dossier de données (défaut : `~/.hlstudio`). |
| `HLSTUDIO_PORT` | Port du serveur local. |
| `HLSTUDIO_WORKSPACE` | Dossier de travail de l'agent. |
| `HLSTUDIO_ALLOWED_HOSTS` | Hôtes supplémentaires autorisés, séparés par des virgules. |
| `HL_AGENT_API_KEY` | Protège `/api/agent` par un jeton `Bearer`. |
| `GITHUB_TOKEN` | Repli si aucun token n'est enregistré dans les Réglages. |
| `NEXT_PUBLIC_PREVIEW_URL` | URL affichée dans le panneau Preview (défaut : `http://localhost:3001`). |

---

## Commandes de développement

```bash
npm run dev         # serveur de développement
npm run build       # build de production (+ copie des fichiers statiques)
npm run start       # lance le build via le CLI local
npm run typecheck   # vérification TypeScript
npm run lint        # ESLint
npm test            # tests unitaires
```

`npm run lint` est volontairement hors du build : `npm run build` sert aussi au
packaging npm, où une analyse de plusieurs minutes à chaque publication
n'apporte rien. La vérification TypeScript, elle, reste dans le build.

---

## Limites connues

- La génération **vidéo** n'est implémentée que pour le protocole Gemini (Veo).
  Il n'existe pas d'équivalent standardisé de `/chat/completions` côté vidéo :
  chaque service a son propre schéma.
- La génération **d'images** passe par `/images/generations` (protocole OpenAI)
  ou `generateContent` (Gemini). Le protocole Anthropic ne produit pas
  d'images.
- L'automatisation du navigateur (Playwright) n'est pas encore là.
- Le panneau Preview suppose qu'un serveur de développement tourne sur le port
  indiqué par `NEXT_PUBLIC_PREVIEW_URL` ; il ne le démarre pas lui-même.

---

## Contribuer

1. Vérifie que `npm run typecheck` et `npm run lint` passent.
2. Ne commite **jamais** `.env*`, `config.json`, `mcp.json` ou `hooks.json`
   contenant des secrets — `.gitignore` les exclut déjà.
3. Toute route qui touche au système de fichiers doit passer par
   `resolveSafePathReal`, et tout appel à `git` par `runGit` (jamais un shell).

## Licence

MIT.
