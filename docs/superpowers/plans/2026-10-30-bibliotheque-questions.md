# Bibliothèque de quiz et de questions, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer une page « Bibliothèque » qui permet de dupliquer des quiz tout prêts et de composer un nouveau quiz à partir d'un catalogue public de questions livré en JSON avec Pengou.

**Architecture:** Un nouveau paquet `@splootlabs/library` contient les fichiers du catalogue (`packages/library/catalog/`), leur schéma zod, le chargeur (catalogue livré, plus fichiers et thèmes d'instance) et les requêtes en mémoire (filtres, tirage). Le serveur charge le catalogue au démarrage et l'expose sous `/api/library/*`. Les copies (duplication, composition) sont écrites dans le tenant de l'utilisateur via un nouveau repo `importQuiz`, avec une colonne `source` (jsonb) ajoutée à `quiz` et `question` pour l'attribution. Le catalogue n'est jamais stocké en base : il vit en mémoire, quelques centaines de questions suffisent largement.

**Tech Stack:** TypeScript, zod 4, Fastify 5, Drizzle sur PostgreSQL (RLS), React 19, react-router 7, Vitest et Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-30-bibliotheque-questions-design.md`

## Global Constraints

- Tout ce qui sort du catalogue est une copie dans le tenant de l'utilisateur ; aucune référence vers le catalogue n'est stockée en base, à part l'identifiant d'origine éventuel dans `source`.
- Le quiz créé appartient au tenant courant et à l'utilisateur (`ownerId = request.user.id`), écrit via `withTenantTx(appDb, context, ...)` comme `POST /api/quizzes`.
- Toute question du catalogue passe `validateQuestionPayload` de `@splootlabs/quiz` et les bornes de `apps/server/src/validation.ts` (`LIMITS.prompt` 500, `LIMITS.title` 200, `LIMITS.description` 2000).
- Pas de média dans le catalogue : la colonne `media` des copies reste `null`.
- `timeLimit` et `readingTime` sont optionnels dans le JSON ; à défaut 20 et 6 (défauts du schéma `question`).
- Critères : `theme` (identifiant d'une liste fixe), `difficulty` ∈ `facile | moyen | difficile`, `language` (code ISO 639-1 en minuscules, par exemple `fr`), `audience` ∈ `enfants | adultes | tous`.
- Fichier d'instance invalide ou en conflit : écarté en entier, erreur journalisée, le reste est servi, le serveur démarre. Catalogue livré invalide : le chargement lève (garanti en CI par un test).
- Thèmes d'instance : ajout, changement de libellé, masquage ; jamais de suppression. Un thème masqué retire ses questions et ses quiz de toutes les réponses de l'API.
- Attribution `{ name, license, url? }` conservée sur les copies, affichée dans la bibliothèque et l'éditeur, jamais pendant la partie.
- Ne jamais lancer `biome format --write` ; `pnpm lint` et `pnpm typecheck` doivent sortir en code 0.
- Textes d'interface en français : pas de tiret cadratin ni demi-cadratin, pas de gras d'emphase, apostrophe droite, guillemets « », pas d'émoji.

## Review Focus

- Tirage demandant plus de questions qu'il n'en existe pour les filtres : renvoie ce qui est disponible, sans doublon, et l'interface l'indique. Testé en Task 2 et Task 6.
- Composition ou duplication citant un identifiant inconnu ou appartenant à un thème masqué : 404/400 sans rien créer (pas de quiz vide orphelin). Testé en Task 4.
- Utilisateur simple membre : le quiz créé apparaît dans sa liste et passe ses contrôles d'appartenance (`ownerPredicate`). Testé en Task 4.
- Fichier d'instance dont un seul élément est invalide : aucune de ses questions n'est servie, les autres fichiers le sont. Testé en Task 1.
- Questions d'origines différentes dans une même composition : chaque question garde sa propre source, le quiz composé a `source = null`. Testé en Task 4.

---

### Task 1: Paquet `@splootlabs/library`, format des fichiers et chargeur

**Files:**
- Create: `packages/library/package.json`, `packages/library/tsconfig.json` (copie de `packages/quiz`, dépendances `zod` et `@splootlabs/quiz`)
- Create: `packages/library/src/schema.ts`, `packages/library/src/load.ts`, `packages/library/src/index.ts`
- Create: `packages/library/catalog/themes.json`, `packages/library/catalog/exemple/pack.json`, `packages/library/catalog/exemple/LICENSE`
- Test: `packages/library/src/load.test.ts`, `packages/library/src/catalog.test.ts`

**Interfaces:**
- Produces (exportés par `index.ts`) :
  - `type Difficulty = 'facile' | 'moyen' | 'difficile'`, `type Audience = 'enfants' | 'adultes' | 'tous'`
  - `type ContentSource = { name: string; license: string; url?: string }`
  - `type Theme = { id: string; label: string }`
  - `type CatalogQuestion = { id: string; type: QuestionType; prompt: string; payload: unknown; theme: string; difficulty: Difficulty; language: string; audience: Audience; timeLimit: number; readingTime: number; source: ContentSource }` (défauts 20 et 6 appliqués au chargement)
  - `type CatalogQuiz = { id: string; title: string; description: string | null; theme: string; difficulty: Difficulty; language: string; audience: Audience; questionIds: string[]; source: ContentSource }`
  - `type Catalog = { themes: Theme[]; questions: CatalogQuestion[]; quizzes: CatalogQuiz[] }` (déjà filtré des thèmes masqués ; `themes` ne contient que les thèmes visibles)
  - `loadCatalog(opts: { builtinDir?: string; extraDir?: string; log?: (msg: string) => void }): Promise<Catalog>`
  - `BUILTIN_CATALOG_DIR: string` (résolu par `fileURLToPath(new URL('../catalog', import.meta.url))`, valable depuis `src` et `dist`)

Format d'un pack (tout fichier `*.json` sauf `themes.json`, cherché récursivement) :

```json
{
  "source": { "name": "OpenQuizzDB", "license": "CC BY-SA 4.0", "url": "https://www.openquizzdb.org" },
  "questions": [
    { "id": "oqdb-0001", "type": "mcq", "prompt": "…", "payload": { "options": [ … ] },
      "theme": "cinema", "difficulty": "facile", "language": "fr", "audience": "tous" }
  ],
  "quizzes": [
    { "id": "oqdb-quiz-cinema-90", "title": "Soirée cinéma années 90", "theme": "cinema",
      "difficulty": "facile", "language": "fr", "audience": "tous", "questionIds": ["oqdb-0001"] }
  ]
}
```

`themes.json` livré : tableau `[{ "id": "cinema", "label": "Cinéma" }, …]` avec au minimum `cinema, musique, sport, histoire, geographie, sciences, litterature, art, nature, gastronomie, jeux-video, culture-generale`. `themes.json` d'instance : `{ "add"?: Theme[], "relabel"?: Record<string,string>, "hide"?: string[] }`.

Règles de validation d'un pack : schéma zod strict ; `payload` validé par `validateQuestionPayload(type, payload)` ; `prompt` 1 à 500 caractères ; `title` 1 à 200 ; `description` au plus 2000 ; `theme` présent dans la liste (masqués compris) ; identifiants uniques dans le pack et contre tout ce qui est déjà chargé ; chaque `questionIds` d'un quiz référence une question du même pack, liste non vide, sans doublon.

Ordre : thèmes livrés, puis `themes.json` d'instance (s'il est invalide ou qu'il ajoute un id déjà existant : ignoré en entier et journalisé ; relabel/hide d'un id inconnu : journalisé et ignoré pour cet id), puis packs livrés (une erreur lève une `Error` qui nomme le fichier et l'élément), puis packs d'instance dans l'ordre alphabétique des chemins (une erreur appelle `log` avec le chemin et la raison, et le fichier est écarté), enfin retrait des questions et quiz des thèmes masqués.

- [ ] **Step 1: Écrire les tests du chargeur** dans `load.test.ts`, avec des dossiers temporaires (`mkdtemp`) :
  - `charge un pack valide et applique les défauts` : `timeLimit` 20, `readingTime` 6, `source` recopiée sur chaque question et quiz.
  - `lève si un pack livré est invalide` : `await expect(loadCatalog({ builtinDir })).rejects.toThrow(/pack\.json/)`.
  - `écarte en entier un pack d'instance dont une question a un payload invalide` : aucune question du fichier dans le résultat, les autres fichiers présents, `log` appelé une fois avec le chemin.
  - `écarte un pack d'instance dont un id entre en conflit avec le catalogue livré` : message de `log` contenant l'id.
  - `écarte un pack dont un quiz référence une question absente du pack`.
  - `thèmes d'instance : add, relabel, hide` : libellé changé, thème ajouté utilisable par un pack d'instance, thème masqué absent de `themes` et ses questions et quiz absents.
  - `thèmes d'instance ajoutant un id existant : fichier ignoré, catalogue livré intact`.
  - `sans extraDir : seul le catalogue livré`.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/library` ; attendu : échec, module introuvable.
- [ ] **Step 3: Implémenter** `schema.ts` (schémas zod des packs et du `themes.json` d'instance) et `load.ts` selon les règles ci-dessus, avec `node:fs/promises`. Créer `catalog/themes.json` et un pack `catalog/exemple/pack.json` minimal (3 questions de types différents, 1 quiz) sous `source.name = "Sploot Labs"`, `license = "Apache-2.0"`, avec son `LICENSE`. Ce pack d'exemple sera remplacé en Task 8.
- [ ] **Step 4: Écrire** `catalog.test.ts` : `le catalogue livré se charge sans erreur` (`loadCatalog({ builtinDir: BUILTIN_CATALOG_DIR })` ne lève pas et renvoie au moins un quiz). C'est le garde-fou CI du catalogue livré.
- [ ] **Step 5: Lancer** `pnpm vitest run packages/library` puis `pnpm install` et `pnpm --filter @splootlabs/library typecheck` ; attendu : tout passe.
- [ ] **Step 6: Commit** `feat(library): paquet catalogue, format JSON et chargeur`.

### Task 2: Requêtes sur le catalogue (filtres, tirage)

**Files:**
- Create: `packages/library/src/query.ts`
- Modify: `packages/library/src/index.ts`
- Test: `packages/library/src/query.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `CatalogQuestion`, `CatalogQuiz` (Task 1)
- Produces :
  - `type CatalogFilters = { theme?: string; difficulty?: Difficulty; language?: string; audience?: Audience; search?: string }`
  - `filterQuestions(catalog: Catalog, filters: CatalogFilters, page: { offset: number; limit: number }): { items: CatalogQuestion[]; total: number }` (ordre stable : ordre du catalogue)
  - `filterQuizzes(catalog: Catalog, filters: Omit<CatalogFilters, 'search'>): CatalogQuiz[]`
  - `drawQuestions(catalog: Catalog, filters: CatalogFilters, count: number, excludeIds: string[], random?: () => number): CatalogQuestion[]`
  - `findQuestions(catalog: Catalog, ids: string[]): CatalogQuestion[] | null` (null si un id est inconnu ; conserve l'ordre de `ids`)
  - `findQuiz(catalog: Catalog, id: string): CatalogQuiz | null`

`search` : recherche insensible à la casse et aux accents dans `prompt` (normalisation NFD et retrait des diacritiques). Un filtre `audience: 'enfants'` ou `'adultes'` inclut aussi les questions `tous`.

- [ ] **Step 1: Écrire les tests** : filtre combiné thème plus difficulté ; `search: 'cinema'` trouve « Cinéma » ; `audience: 'enfants'` inclut `tous` mais pas `adultes` ; pagination (`total` inchangé, `items.length <= limit`) ; `drawQuestions` avec `count` supérieur au disponible renvoie tout le disponible ; `drawQuestions` n'inclut aucun `excludeIds` et aucun doublon ; `drawQuestions` avec un `random` déterministe renvoie un ordre reproductible ; `findQuestions` renvoie `null` si un id manque.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/library/src/query.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter** `query.ts` (tirage par mélange de Fisher-Yates sur les candidats, puis troncature à `count`).
- [ ] **Step 4: Lancer** le même test ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(library): filtres et tirage au hasard`.

### Task 3: Colonne `source` et repo `importQuiz`

**Files:**
- Create: `packages/db/drizzle/0018_content_source.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` (entrée `idx: 18`, `tag: "0018_content_source"`, `when` supérieur à la précédente), `packages/db/src/schema.ts` (`source: jsonb('source').$type<ContentSource>()` nullable sur `quiz` et `question`), `packages/db/src/repos/quiz.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/repos/quiz.test.ts`

**Interfaces:**
- Produces :
  - `type ContentSource = { name: string; license: string; url?: string }` exporté par `@splootlabs/db` (défini dans `schema.ts`)
  - `type ImportedQuestion = { type: 'mcq' | 'truefalse' | 'text' | 'slider'; prompt: string; payload: unknown; timeLimit: number; readingTime: number; source: ContentSource | null }`
  - `importQuiz(scope: TenantScope, input: { ownerId: string; title: string; description?: string | null; source: ContentSource | null; questions: ImportedQuestion[] }): Promise<Quiz>` : insère le quiz puis ses questions (`orderIndex` 0..n-1, `media` null) dans le scope courant. Pas de transaction interne : l'appelant est déjà dans `withTenantTx`.
  - `listQuizzes` renvoie aussi `source` (ajouter la colonne à son `select`).

Migration : `ALTER TABLE "quiz" ADD COLUMN "source" jsonb;` et idem pour `question`, séparés par `--> statement-breakpoint`, comme les migrations écrites à la main 0016 et 0017. Les policies RLS existantes couvrent déjà ces colonnes.

- [ ] **Step 1: Écrire les tests** dans `quiz.test.ts` : `importQuiz crée le quiz et ses questions dans l'ordre, avec leurs sources` (vérifie `orderIndex`, `source` du quiz et de chaque question, `media` null, `tenantId` du scope) ; `importQuiz sous appDb et withTenantTx respecte la RLS` (le quiz n'est pas visible depuis un autre tenant) ; `listQuizzes expose source`.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/db/src/repos/quiz.test.ts` ; attendu : échec.
- [ ] **Step 3: Écrire la migration, mettre à jour le schéma et implémenter `importQuiz`.**
- [ ] **Step 4: Lancer** `pnpm vitest run packages/db` ; attendu : PASS (dont `migrate.test.ts` et `schema.test.ts`).
- [ ] **Step 5: Commit** `feat(db): colonne source et import de quiz`.

### Task 4: Routes serveur `/api/library`

**Files:**
- Create: `apps/server/src/routes/library.ts`
- Modify: `packages/shared/src/config.ts` (variable `LIBRARY_EXTRA_DIR` optionnelle, exposée en `config.libraryExtraDir?: string`), `apps/server/src/editor.ts` (deps `catalog: Catalog`), `apps/server/src/index.ts` (`const catalog = await loadCatalog({ extraDir: config.libraryExtraDir, log: (m) => app.log.error(m) })` avant `registerEditor`), `apps/server/package.json` (dépendance `@splootlabs/library`), `.env.example` ou documentation de configuration si elle liste les variables
- Test: `apps/server/src/routes-library.test.ts`

**Interfaces:**
- Consumes: `loadCatalog`, `filterQuestions`, `filterQuizzes`, `drawQuestions`, `findQuestions`, `findQuiz` (Tasks 1 et 2) ; `importQuiz`, `ContentSource` (Task 3) ; `requireUser`, `resolveContextOr403`, `withTenantTx`.
- Produces : `registerLibraryRoutes(app: FastifyInstance, deps: { systemDb: Db; appDb: Db; config: AppConfig; catalog: Catalog }): void`, et l'API suivante (toutes derrière `requireUser`) :
  - `GET /api/library/meta` → `{ themes: Theme[]; difficulties: Difficulty[]; audiences: Audience[]; languages: string[] }` (langues présentes dans le catalogue, triées)
  - `GET /api/library/quizzes?theme&difficulty&language&audience` → `Array<Omit<CatalogQuiz,'questionIds'> & { questionCount: number }>`
  - `GET /api/library/questions?theme&difficulty&language&audience&search&offset&limit` → `{ items: CatalogQuestion[]; total: number }` ; `limit` par défaut 50, borné à 100
  - `POST /api/library/draw` corps `{ filters: CatalogFilters; count: number; excludeIds?: string[] }` → `{ items: CatalogQuestion[] }` ; `count` entier de 1 à 50, sinon 400
  - `POST /api/library/quizzes/:id/duplicate` → 201 `Quiz` (titre, description et source du quiz du catalogue, questions dans l'ordre de `questionIds`) ; 404 `{ error: 'Quiz introuvable dans la bibliothèque.' }`
  - `POST /api/library/compose` corps `{ title: string; questionIds: string[] }` → 201 `Quiz` avec `source: null` et chaque question avec sa source ; 400 si titre vide ou trop long, liste vide, plus de 100 ids, ou doublons ; 404 `{ error: 'Question introuvable dans la bibliothèque.' }` si `findQuestions` renvoie `null`
  - Les deux routes d'écriture appellent `resolveContextOr403` puis `withTenantTx(appDb, context, (scope) => importQuiz(scope, …))` avec `ownerId: request.user.id`.

- [ ] **Step 1: Écrire les tests** sur le modèle de `routes-quizzes.test.ts` (`buildApp` passant un catalogue de test construit en mémoire) : 401 sans cookie sur chaque route ; `meta` liste les thèmes ; filtres et pagination de `questions` ; `draw` renvoie au plus le disponible et 400 pour `count: 0` ; `duplicate` crée un quiz visible ensuite par `GET /api/quizzes` avec ses questions (`GET /api/quizzes/:id/questions`) et `source` ; `duplicate` d'un id inconnu → 404 et aucun quiz créé ; `compose` avec deux questions de sources différentes → quiz `source: null`, questions avec leurs sources respectives, ordre respecté ; `compose` avec un id inconnu → 404 et le nombre de quiz de l'utilisateur est inchangé ; un utilisateur `member` d'un workspace (voir le montage de `routes-workspaces.test.ts`) qui compose voit le quiz dans sa liste et peut le modifier (`PATCH /api/quizzes/:id` → 200).
- [ ] **Step 2: Lancer** `pnpm vitest run apps/server/src/routes-library.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter** `routes/library.ts`, la variable de configuration et le câblage. Pour les quiz du catalogue, la validation des entrées de requête suit le style de `routes/quizzes.ts` (garde-fous écrits à la main, messages d'erreur en français).
- [ ] **Step 4: Lancer** `pnpm vitest run apps/server` puis `pnpm typecheck` ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(server): routes de la bibliothèque`.

### Task 5: Client API web et types `source`

**Files:**
- Create: `apps/web/src/api/library.ts`
- Modify: `apps/web/src/api/quizzes.ts` (champ `source: ContentSource | null` sur `Quiz` et `Question`, type `ContentSource` exporté)
- Test: `apps/web/src/api/library.test.ts`

**Interfaces:**
- Consumes: `apiGet`, `apiPost` de `./client` ; routes de la Task 4.
- Produces : types miroirs `Theme`, `Difficulty`, `Audience`, `CatalogQuestion`, `CatalogQuizSummary`, `CatalogFilters`, `LibraryMeta`, et les fonctions `getLibraryMeta()`, `listLibraryQuizzes(filters)`, `listLibraryQuestions(filters, page)`, `drawLibraryQuestions(filters, count, excludeIds)`, `duplicateLibraryQuiz(id): Promise<Quiz>`, `composeQuiz(title, questionIds): Promise<Quiz>`. Les filtres vides ne sont pas envoyés dans la query string.

- [ ] **Step 1: Écrire les tests** sur le modèle de `quizzes.test.ts` : chemin, méthode et corps de chaque fonction ; `listLibraryQuestions({ theme: 'cinema' }, { offset: 0, limit: 50 })` appelle `/api/library/questions?theme=cinema&offset=0&limit=50`.
- [ ] **Step 2: Lancer** `pnpm vitest run apps/web/src/api/library.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer** le test et `pnpm --filter @splootlabs/web typecheck` (nom du paquet web à vérifier dans `apps/web/package.json`) ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(web): client API de la bibliothèque`.

### Task 6: Écran Bibliothèque

**Files:**
- Create: `apps/web/src/screens/Library.tsx`, `apps/web/src/ui/SourceCredit.tsx`
- Modify: `apps/web/src/routes.tsx` (route protégée `/library`, montée comme `/workspace`), `apps/web/src/screens/Home.tsx` (lien « Bibliothèque » dans l'en-tête de la section « Mes quiz »)
- Test: `apps/web/src/screens/Library.test.tsx`, `apps/web/src/screens/Home.test.tsx`

**Interfaces:**
- Consumes: fonctions de la Task 5.
- Produces : `SourceCredit({ source }: { source: ContentSource | null }): JSX.Element | null` affiche `Source : {name}, licence {license}` (nom en lien si `url`), rien si `source` est `null`. Réutilisé en Task 7.

Comportement (maquettes validées dans la conception) :
- Deux onglets, « Quiz tout prêts » (par défaut) et « Questions », accessibles au clavier (`role="tablist"`).
- Filtres communs : thème, difficulté, langue, public (listes déroulantes alimentées par `getLibraryMeta`, option « Tous »).
- Onglet quiz : cartes avec titre, nombre de questions, difficulté, `SourceCredit`, bouton « Dupliquer » qui appelle `duplicateLibraryQuiz` puis navigue vers `/quizzes/:id`.
- Onglet questions : champ de recherche, liste paginée (bouton « Afficher plus ») de questions avec case à cocher, type, énoncé, difficulté et `SourceCredit` ; champ « Tirer N questions au hasard » (1 à 50) et bouton « Tirer » qui ajoute à la sélection le résultat de `drawLibraryQuestions` en excluant la sélection courante. Si le tirage renvoie moins que demandé, message `Seulement {n} questions disponibles avec ces filtres.` (au singulier si `n` vaut 1, et `Aucune question disponible avec ces filtres.` si 0).
- Panneau « Ma sélection ({n}) » : liste ordonnée, retrait possible, bouton « Créer le quiz » désactivé si vide, qui demande un titre (champ dans le panneau, requis) puis appelle `composeQuiz` et navigue vers `/quizzes/:id`.
- Erreurs réseau affichées en ligne, comme dans `Home.tsx`.

- [ ] **Step 1: Écrire les tests** (API mockée via `vi.mock('../api/library')`) : onglet quiz par défaut et « Dupliquer » navigue vers l'éditeur du quiz renvoyé ; cocher deux questions puis « Créer le quiz » avec un titre appelle `composeQuiz('Mon quiz', [id1, id2])` ; « Créer le quiz » désactivé quand la sélection est vide ; tirage partiel affiche le message de disponibilité et n'ajoute pas de doublon ; changement de filtre relance `listLibraryQuestions` avec le filtre ; `SourceCredit` affiche nom et licence. Dans `Home.test.tsx` : un lien « Bibliothèque » pointe vers `/library`.
- [ ] **Step 2: Lancer** `pnpm vitest run apps/web/src/screens/Library.test.tsx apps/web/src/screens/Home.test.tsx` ; attendu : échec.
- [ ] **Step 3: Implémenter** l'écran, le composant et la route, avec les classes et jetons visuels existants (`home-section`, `Button`, variables `--space-*`).
- [ ] **Step 4: Lancer** les tests et le typecheck web ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(web): écran Bibliothèque`.

### Task 7: Attribution dans l'éditeur

**Files:**
- Modify: `apps/web/src/screens/HostEditor.tsx`
- Test: `apps/web/src/screens/HostEditor.test.tsx`

**Interfaces:**
- Consumes: `SourceCredit` (Task 6), `Quiz.source` et `Question.source` (Task 5).

- [ ] **Step 1: Écrire les tests** : un quiz avec `source` affiche `SourceCredit` sous le titre ; une question avec `source` l'affiche dans sa carte ; un quiz et des questions sans `source` n'affichent aucune mention « Source : ».
- [ ] **Step 2: Lancer** `pnpm vitest run apps/web/src/screens/HostEditor.test.tsx` ; attendu : échec.
- [ ] **Step 3: Implémenter** : `SourceCredit` sous le champ « Titre du quiz » et dans la carte de chaque question. Aucun changement dans `HostLive`, `BigScreen`, `PlayerLive` ni `SessionReport`.
- [ ] **Step 4: Lancer** le test ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(web): attribution des sources dans l'éditeur`.

### Task 8: Contenu initial du catalogue

**Files:**
- Create: `packages/library/catalog/<source>/` (un dossier par source : `LICENSE` ou `LICENSE.md` avec le texte ou le lien de la licence et l'attribution exacte demandée, puis un ou plusieurs packs JSON)
- Create: `packages/library/scripts/convert-<source>.ts` (script de conversion reproductible, hors `src`, lancé avec `tsx`)
- Delete: `packages/library/catalog/exemple/`
- Modify: `packages/library/src/catalog.test.ts`, `LICENSING.md` et `NOTICE` (mention des données du catalogue et de leurs licences)

Sources candidates : OpenQuizzDB (français) et Open Trivia DB (anglais). Avant toute conversion, vérifier sur le site de chaque source que la licence autorise la redistribution et les œuvres dérivées, et relever l'attribution exacte demandée. Si une licence est absente, ambiguë ou non commerciale, ne pas l'utiliser et s'arrêter pour en parler à Julien.

- [ ] **Step 1: Renforcer** `catalog.test.ts` : au moins 300 questions, au moins 10 quiz, chaque thème livré utilisé par au moins une question, au moins une langue `fr`, chaque dossier de source contient un fichier `LICENSE*`.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/library/src/catalog.test.ts` ; attendu : échec sur les seuils.
- [ ] **Step 3: Écrire le script de conversion**, qui associe catégories et niveaux de la source aux thèmes, difficultés et publics Pengou, et génère des identifiants stables dérivés de ceux de la source (préfixe par source). Générer les packs et composer au moins 10 quiz thématiques de 10 à 20 questions.
- [ ] **Step 4: Lancer** `pnpm vitest run packages/library` puis `pnpm test` ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(library): catalogue initial`.

### Task 9: Vérification de bout en bout

- [ ] **Step 1:** `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` ; attendu : code 0 pour chacun.
- [ ] **Step 2:** Démarrer l'application (`pnpm dev` et le serveur web), ouvrir `/library`, dupliquer un quiz, composer un quiz par tirage et par sélection, vérifier l'attribution dans l'éditeur, lancer une partie et vérifier qu'aucune mention de source n'apparaît côté joueurs et grand écran.
- [ ] **Step 3:** Démarrer avec `LIBRARY_EXTRA_DIR` pointant vers un dossier contenant un pack invalide et un `themes.json` qui masque un thème ; vérifier l'erreur journalisée, le démarrage normal et la disparition du thème masqué.
