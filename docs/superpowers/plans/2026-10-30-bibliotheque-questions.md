# Bibliothèque de quiz et de questions, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer une page « Bibliothèque » qui permet de dupliquer des quiz tout prêts et de composer un nouveau quiz à partir d'un catalogue public de questions, livré en JSON avec Pengou et stocké en base.

**Architecture:** Un nouveau paquet `@splootlabs/library` contient les fichiers du catalogue (`packages/library/catalog/`), leur schéma zod et un lecteur qui produit un instantané validé (catalogue livré, plus fichiers et thèmes d'instance), sans accès à la base. `@splootlabs/db` gagne des tables `library_*` communes à l'instance (hors tenant, lecture seule pour `app_role`), une fonction `syncLibrary` qui recopie l'instantané en base au démarrage, et les requêtes de lecture (filtres, tirage). Les copies (duplication, composition) sont écrites dans le tenant de l'utilisateur via `importQuiz`, avec une colonne `source` (jsonb) ajoutée à `quiz` et `question` pour l'attribution.

**Tech Stack:** TypeScript, zod 4, Fastify 5, Drizzle sur PostgreSQL (RLS), React 19, react-router 7, Vitest et Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-30-bibliotheque-questions-design.md`

## Global Constraints

- Tout ce qui sort du catalogue est une copie dans le tenant de l'utilisateur : aucune clé étrangère d'une table de tenant vers une table `library_*`.
- Le quiz créé appartient au tenant courant et à l'utilisateur (`ownerId = request.user.id`), écrit via `withTenantTx(appDb, context, ...)` comme `POST /api/quizzes`.
- Tables `library_*` : pas de `tenant_id`, pas de RLS, `GRANT SELECT` seulement à `app_role`. Seule la connexion privilégiée (`systemDb`) y écrit, pendant la synchronisation.
- Chaque ligne du catalogue porte `origin` (`builtin` ou `instance`) et `origin_file`. La synchronisation ne touche que les lignes de ces deux origines ; d'autres origines viendront plus tard.
- Toute question du catalogue passe `validateQuestionPayload` de `@splootlabs/quiz` et les bornes de `apps/server/src/validation.ts` (`LIMITS.prompt` 500, `LIMITS.title` 200, `LIMITS.description` 2000).
- Pas de média dans le catalogue : la colonne `media` des copies reste `null`.
- `timeLimit` et `readingTime` sont optionnels dans le JSON ; à défaut 20 et 6 (défauts du schéma `question`).
- Critères : `theme` (identifiant d'une liste fixe), `difficulty` ∈ `facile | moyen | difficile`, `language` (code ISO 639-1 en minuscules, par exemple `fr`), `audience` ∈ `enfants | adultes | tous`.
- Fichier d'instance invalide ou en conflit : sa nouvelle version est écartée en entier, l'erreur est journalisée, ses lignes déjà en base sont conservées, le serveur démarre. Catalogue livré invalide : la lecture lève (garanti en CI par un test).
- Une question ou un quiz absent des fichiers valides (et non rattaché à un fichier écarté) est supprimé de la base à la synchronisation.
- Thèmes d'instance : ajout, changement de libellé, masquage ; jamais de suppression. Un thème masqué retire ses questions et ses quiz de toutes les réponses de l'API.
- Attribution `{ name, license, url? }` conservée sur les copies, affichée dans la bibliothèque et l'éditeur, jamais pendant la partie.
- Ne jamais lancer `biome format --write` ; `pnpm lint` et `pnpm typecheck` doivent sortir en code 0.
- Textes d'interface en français : pas de tiret cadratin ni demi-cadratin, pas de gras d'emphase, apostrophe droite, guillemets « », pas d'émoji.

## Review Focus

- Deux synchronisations simultanées (redémarrage pendant qu'une autre instance démarre) : elles se sérialisent sans erreur ni doublon grâce au verrou consultatif. Testé en Task 2.
- Tirage demandant plus de questions qu'il n'en existe pour les filtres : renvoie ce qui est disponible, sans doublon, et l'interface l'indique. Testé en Task 3 et Task 6.
- Composition ou duplication citant un identifiant inconnu ou appartenant à un thème masqué : 404 sans rien créer (pas de quiz vide orphelin). Testé en Task 4.
- Utilisateur simple membre : le quiz créé apparaît dans sa liste et passe ses contrôles d'appartenance (`ownerPredicate`). Testé en Task 4.
- Fichier d'instance devenu invalide après une synchronisation réussie : ses questions restent servies dans leur version précédente. Testé en Task 2.

---

### Task 1: Paquet `@splootlabs/library`, format des fichiers et lecteur

**Files:**
- Create: `packages/library/package.json`, `packages/library/tsconfig.json` (copie de `packages/quiz`, dépendances `zod` et `@splootlabs/quiz`)
- Create: `packages/library/src/schema.ts`, `packages/library/src/read.ts`, `packages/library/src/index.ts`
- Create: `packages/library/catalog/themes.json`, `packages/library/catalog/exemple/pack.json`, `packages/library/catalog/exemple/LICENSE`
- Test: `packages/library/src/read.test.ts`, `packages/library/src/catalog.test.ts`

**Interfaces:**
- Produces (exportés par `index.ts`) :
  - `type Difficulty = 'facile' | 'moyen' | 'difficile'`, `type Audience = 'enfants' | 'adultes' | 'tous'`, `type Origin = 'builtin' | 'instance'`
  - `type ContentSource = { name: string; license: string; url?: string }`
  - `type SnapshotTheme = { id: string; label: string; hidden: boolean; origin: Origin }`
  - `type SnapshotQuestion = { id: string; type: QuestionType; prompt: string; payload: unknown; theme: string; difficulty: Difficulty; language: string; audience: Audience; timeLimit: number; readingTime: number; source: ContentSource; origin: Origin; originFile: string }` (défauts 20 et 6 appliqués)
  - `type SnapshotQuiz = { id: string; title: string; description: string | null; theme: string; difficulty: Difficulty; language: string; audience: Audience; questionIds: string[]; source: ContentSource; origin: Origin; originFile: string }`
  - `type CatalogSnapshot = { themes: SnapshotTheme[]; questions: SnapshotQuestion[]; quizzes: SnapshotQuiz[]; rejectedFiles: string[] }`
  - `readCatalog(opts: { builtinDir?: string; extraDir?: string; log?: (msg: string) => void }): Promise<CatalogSnapshot>`
  - `BUILTIN_CATALOG_DIR: string` (résolu par `fileURLToPath(new URL('../catalog', import.meta.url))`, valable depuis `src` et `dist`)

`originFile` vaut `builtin:<chemin relatif>` ou `instance:<chemin relatif>`, avec des `/` quel que soit l'OS.

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

Règles de validation d'un pack : schéma zod strict ; `payload` validé par `validateQuestionPayload(type, payload)` ; `prompt` 1 à 500 caractères ; `title` 1 à 200 ; `description` au plus 2000 ; `theme` présent dans la liste (masqués compris) ; identifiants uniques dans le pack et par rapport à tout ce qui est déjà lu ; chaque `questionIds` d'un quiz référence une question du même pack, liste non vide, sans doublon.

Ordre : thèmes livrés, puis `themes.json` d'instance (s'il est invalide ou s'il ajoute un id déjà existant : ignoré en entier et journalisé ; relabel ou hide d'un id inconnu : journalisé et ignoré pour cet id), puis packs livrés (une erreur lève une `Error` qui nomme le fichier et l'élément), puis packs d'instance dans l'ordre alphabétique des chemins (une erreur appelle `log` avec le chemin et la raison, ajoute l'`originFile` à `rejectedFiles` et écarte le fichier). Le lecteur garde les questions des thèmes masqués : le masquage est appliqué par les requêtes (Task 3).

- [ ] **Step 1: Écrire les tests du lecteur** dans `read.test.ts`, avec des dossiers temporaires (`mkdtemp`) :
  - `lit un pack valide et applique les défauts` : `timeLimit` 20, `readingTime` 6, `source`, `origin` et `originFile` recopiés sur chaque question et quiz.
  - `lève si un pack livré est invalide` : `await expect(readCatalog({ builtinDir })).rejects.toThrow(/pack\.json/)`.
  - `écarte en entier un pack d'instance dont une question a un payload invalide` : aucune question du fichier dans le résultat, `rejectedFiles` contient son `originFile`, les autres fichiers présents, `log` appelé une fois avec le chemin.
  - `écarte un pack d'instance dont un id entre en conflit avec le catalogue livré` : message de `log` contenant l'id.
  - `écarte un pack dont un quiz référence une question absente du pack`.
  - `thèmes d'instance : add, relabel, hide` : libellé changé, thème ajouté (`origin: 'instance'`) utilisable par un pack d'instance, thème masqué présent avec `hidden: true`.
  - `thèmes d'instance ajoutant un id existant : fichier ignoré, thèmes livrés intacts`.
  - `sans extraDir : seul le catalogue livré`.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/library` ; attendu : échec, module introuvable.
- [ ] **Step 3: Implémenter** `schema.ts` et `read.ts` selon les règles ci-dessus, avec `node:fs/promises`. Créer `catalog/themes.json` et un pack `catalog/exemple/pack.json` minimal (3 questions de types différents, 1 quiz) avec `source.name = "Sploot Labs"`, `license = "Apache-2.0"`, et son `LICENSE`. Ce pack d'exemple sera remplacé en Task 8.
- [ ] **Step 4: Écrire** `catalog.test.ts` : `le catalogue livré se lit sans erreur` (`readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })` ne lève pas et renvoie au moins un quiz). C'est le garde-fou CI du catalogue livré.
- [ ] **Step 5: Lancer** `pnpm install`, `pnpm vitest run packages/library` et `pnpm --filter @splootlabs/library typecheck` ; attendu : tout passe.
- [ ] **Step 6: Commit** `feat(library): paquet catalogue, format JSON et lecteur`.

### Task 2: Tables du catalogue et synchronisation

**Files:**
- Create: `packages/db/drizzle/0018_library.sql`, `packages/db/src/repos/library-sync.ts`
- Modify: `packages/db/drizzle/meta/_journal.json` (entrée `idx: 18`, `tag: "0018_library"`, `when` supérieur à la précédente), `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/package.json` (dépendance `@splootlabs/library` pour les types de l'instantané)
- Test: `packages/db/src/repos/library-sync.test.ts`

**Interfaces:**
- Consumes: `CatalogSnapshot` et ses types (Task 1).
- Produces :
  - Enums `library_difficulty` (`facile`, `moyen`, `difficile`), `library_audience` (`enfants`, `adultes`, `tous`), `library_origin` (`builtin`, `instance`).
  - `libraryTheme` : `id text pk`, `label text not null`, `hidden boolean not null default false`, `origin library_origin not null`.
  - `libraryQuestion` : `id text pk`, `type question_type`, `prompt text`, `promptSearch text` (prompt en minuscules sans diacritiques, calculé à la synchronisation), `payload jsonb`, `themeId text` FK `library_theme.id`, `difficulty`, `language text`, `audience`, `timeLimit int`, `readingTime int`, `source jsonb not null`, `origin`, `originFile text`, `updatedAt timestamptz` ; index sur `(theme_id, difficulty, language, audience)`.
  - `libraryQuiz` : `id text pk`, `title`, `description` nullable, `themeId` FK, `difficulty`, `language`, `audience`, `source jsonb not null`, `origin`, `originFile`, `updatedAt`.
  - `libraryQuizQuestion` : `quizId` FK `library_quiz.id` on delete cascade, `questionId` FK `library_question.id` on delete cascade, `position int` ; clé primaire `(quiz_id, position)`.
  - `quiz.source` et `question.source` : `jsonb('source').$type<ContentSource>()` nullable.
  - `syncLibrary(db: Db, snapshot: CatalogSnapshot): Promise<{ themes: number; questions: number; quizzes: number; deleted: number }>`.

Migration : création des enums et des quatre tables, `ALTER TABLE "quiz" ADD COLUMN "source" jsonb;` et idem pour `question`, puis `GRANT SELECT ON "library_theme", "library_question", "library_quiz", "library_quiz_question" TO app_role;`. Pas d'`ENABLE ROW LEVEL SECURITY` sur ces tables. Écrite à la main comme 0016 et 0017, instructions séparées par `--> statement-breakpoint`.

`syncLibrary` s'exécute dans une seule transaction qui commence par `select pg_advisory_xact_lock(hashtext('pengou_library_sync'))`. Elle upserte les thèmes, les questions et les quiz de l'instantané (par `id`), remplace les lignes `library_quiz_question` des quiz upsertés, supprime les questions et quiz d'origine `builtin` ou `instance` dont l'id n'est pas dans l'instantané et dont l'`originFile` n'est pas dans `rejectedFiles`, puis supprime les thèmes absents de l'instantané qui ne sont plus référencés. Une question gardée d'un fichier rejeté qui référence un thème disparu bloque cette suppression : le thème est conservé.

- [ ] **Step 1: Écrire les tests** (`startTestDb` et `runMigrations`, instantanés construits à la main) :
  - `insère thèmes, questions, quiz et leur ordre`.
  - `une seconde synchronisation identique ne change rien` (mêmes comptes, pas de doublon).
  - `met à jour une question modifiée et supprime une question retirée` (et le quiz qui la contenait perd la ligne de liaison).
  - `conserve les lignes d'un fichier rejeté` : synchroniser un instantané avec un fichier d'instance, puis un instantané où ce fichier est dans `rejectedFiles` et absent des questions ; ses questions sont toujours là.
  - `deux synchronisations concurrentes réussissent` (`Promise.all` de deux appels, aucune erreur, comptes finaux corrects).
  - `app_role peut lire mais pas écrire` : `appDb` lit `library_question` sans contexte tenant ; un insert lève une erreur de permission.
  - `quiz et question acceptent source` (insert via `createQuiz` sans source toujours valide).
- [ ] **Step 2: Lancer** `pnpm vitest run packages/db/src/repos/library-sync.test.ts` ; attendu : échec.
- [ ] **Step 3: Écrire la migration, compléter le schéma et implémenter `syncLibrary`.**
- [ ] **Step 4: Lancer** `pnpm vitest run packages/db` ; attendu : PASS (dont `migrate.test.ts`, `schema.test.ts` et les tests RLS).
- [ ] **Step 5: Commit** `feat(db): tables du catalogue et synchronisation`.

### Task 3: Requêtes du catalogue et `importQuiz`

**Files:**
- Create: `packages/db/src/repos/library.ts`
- Modify: `packages/db/src/repos/quiz.ts` (`importQuiz`, `source` dans le `select` de `listQuizzes`), `packages/db/src/index.ts`
- Test: `packages/db/src/repos/library.test.ts`, `packages/db/src/repos/quiz.test.ts`

**Interfaces:**
- Consumes: tables de la Task 2.
- Produces :
  - `type LibraryFilters = { theme?: string; difficulty?: Difficulty; language?: string; audience?: Audience; search?: string }`
  - `type LibraryQuestion = { id; type; prompt; payload; theme; difficulty; language; audience; timeLimit; readingTime; source: ContentSource }` et `type LibraryQuizSummary = { id; title; description; theme; difficulty; language; audience; source; questionCount: number }`
  - `listLibraryThemes(db: Db): Promise<{ id: string; label: string }[]>` (thèmes visibles, triés par libellé), `listLibraryLanguages(db: Db): Promise<string[]>`
  - `searchLibraryQuestions(db: Db, filters: LibraryFilters, page: { offset: number; limit: number }): Promise<{ items: LibraryQuestion[]; total: number }>` (tri par `id`)
  - `listLibraryQuizzes(db: Db, filters: Omit<LibraryFilters, 'search'>): Promise<LibraryQuizSummary[]>` (tri par titre)
  - `drawLibraryQuestions(db: Db, filters: LibraryFilters, count: number, excludeIds: string[]): Promise<LibraryQuestion[]>` (`order by random() limit count`)
  - `getLibraryQuestions(db: Db, ids: string[]): Promise<LibraryQuestion[] | null>` (null si un id est inconnu ou masqué ; conserve l'ordre de `ids`)
  - `getLibraryQuiz(db: Db, id: string): Promise<{ quiz: LibraryQuizSummary; questions: LibraryQuestion[] } | null>` (questions dans l'ordre `position`)
  - `type ImportedQuestion = { type: QuestionType; prompt: string; payload: unknown; timeLimit: number; readingTime: number; source: ContentSource | null }`
  - `importQuiz(scope: TenantScope, input: { ownerId: string; title: string; description?: string | null; source: ContentSource | null; questions: ImportedQuestion[] }): Promise<Quiz>` : insère le quiz puis ses questions (`orderIndex` 0..n-1, `media` null) dans le scope courant, sans transaction interne (l'appelant est dans `withTenantTx`).

Toutes les lectures excluent les thèmes masqués (jointure sur `library_theme.hidden = false`). `search` se compare à `prompt_search` avec `like` sur le terme normalisé de la même façon (minuscules, NFD, diacritiques retirés), en échappant `%` et `_`. Un filtre `audience: 'enfants'` ou `'adultes'` inclut aussi `tous`.

- [ ] **Step 1: Écrire les tests** (`library.test.ts`, données posées par `syncLibrary`) : filtre combiné thème plus difficulté ; `search: 'cinema'` trouve « Cinéma » et `search: '100%'` ne se comporte pas comme un joker ; `audience: 'enfants'` inclut `tous` mais pas `adultes` ; pagination (`total` inchangé, `items.length <= limit`) ; thème masqué absent de toutes les fonctions et `getLibraryQuestions` renvoie `null` pour une de ses questions ; `drawLibraryQuestions` avec `count` supérieur au disponible renvoie tout le disponible, sans `excludeIds` ni doublon ; `getLibraryQuiz` renvoie les questions dans l'ordre. Dans `quiz.test.ts` : `importQuiz crée le quiz et ses questions dans l'ordre, avec leurs sources` (`orderIndex`, `source` du quiz et de chaque question, `media` null, `tenantId` du scope) ; `importQuiz sous appDb et withTenantTx respecte la RLS` ; `listQuizzes expose source`.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/db/src/repos/library.test.ts packages/db/src/repos/quiz.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter** `repos/library.ts` et `importQuiz`.
- [ ] **Step 4: Lancer** `pnpm vitest run packages/db` ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(db): requêtes du catalogue et import de quiz`.

### Task 4: Synchronisation au démarrage et routes `/api/library`

**Files:**
- Create: `apps/server/src/routes/library.ts`
- Modify: `packages/shared/src/config.ts` (variable `LIBRARY_EXTRA_DIR` optionnelle, exposée en `config.libraryExtraDir?: string`), `apps/server/src/index.ts`, `apps/server/src/editor.ts`, `apps/server/package.json` (dépendance `@splootlabs/library`), la documentation des variables d'environnement si le dépôt en a une (`README.md` ou `docs/devops.md`)
- Test: `apps/server/src/routes-library.test.ts`

**Interfaces:**
- Consumes: `readCatalog`, `BUILTIN_CATALOG_DIR` (Task 1) ; `syncLibrary` (Task 2) ; fonctions de la Task 3 ; `requireUser`, `resolveContextOr403`, `withTenantTx`.
- Produces : `registerLibraryRoutes(app: FastifyInstance, deps: { systemDb: Db; appDb: Db; config: AppConfig }): void`, appelée par `registerEditor`, et l'API suivante (toutes derrière `requireUser` ; les lectures utilisent `appDb` hors `withTenantTx`) :
  - `GET /api/library/meta` → `{ themes: { id; label }[]; difficulties: Difficulty[]; audiences: Audience[]; languages: string[] }`
  - `GET /api/library/quizzes?theme&difficulty&language&audience` → `LibraryQuizSummary[]`
  - `GET /api/library/questions?theme&difficulty&language&audience&search&offset&limit` → `{ items: LibraryQuestion[]; total: number }` ; `limit` par défaut 50, borné à 100 ; valeurs d'enum inconnues → 400
  - `POST /api/library/draw` corps `{ filters: LibraryFilters; count: number; excludeIds?: string[] }` → `{ items: LibraryQuestion[] }` ; `count` entier de 1 à 50, `excludeIds` au plus 200, sinon 400
  - `POST /api/library/quizzes/:id/duplicate` → 201 `Quiz` (titre, description et source du quiz du catalogue, questions dans l'ordre) ; 404 `{ error: 'Quiz introuvable dans la bibliothèque.' }`
  - `POST /api/library/compose` corps `{ title: string; questionIds: string[] }` → 201 `Quiz` avec `source: null` et chaque question avec sa source ; 400 si titre vide ou trop long, liste vide, plus de 100 ids, ou doublons ; 404 `{ error: 'Question introuvable dans la bibliothèque.' }` si `getLibraryQuestions` renvoie `null`
  - Les deux routes d'écriture lisent le catalogue avant d'ouvrir `withTenantTx(appDb, context, (scope) => importQuiz(scope, …))`, avec `ownerId: request.user.id`.

Démarrage, dans `index.ts`, après les migrations et avant `registerEditor` : `const snapshot = await readCatalog({ extraDir: config.libraryExtraDir, log: (m) => app.log.error(m) })` puis `const counts = await syncLibrary(systemDb, snapshot)` et un `app.log.info` des comptes. Une erreur de lecture du catalogue livré fait échouer le démarrage, comme une migration en échec.

- [ ] **Step 1: Écrire les tests** sur le modèle de `routes-quizzes.test.ts` (catalogue de test posé par `syncLibrary` dans `beforeAll`) : 401 sans cookie sur chaque route ; `meta` liste les thèmes visibles ; filtres et pagination de `questions` et 400 pour `difficulty=extreme` ; `draw` renvoie au plus le disponible et 400 pour `count: 0` ; `duplicate` crée un quiz visible ensuite par `GET /api/quizzes` avec ses questions (`GET /api/quizzes/:id/questions`) et `source` ; `duplicate` d'un id inconnu → 404 et aucun quiz créé ; `compose` avec deux questions de sources différentes → quiz `source: null`, questions avec leurs sources respectives, ordre respecté ; `compose` avec un id inconnu → 404 et le nombre de quiz de l'utilisateur inchangé ; un utilisateur `member` d'un workspace (montage de `routes-workspaces.test.ts`) qui compose voit le quiz dans sa liste et peut le modifier (`PATCH /api/quizzes/:id` → 200).
- [ ] **Step 2: Lancer** `pnpm vitest run apps/server/src/routes-library.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter** `routes/library.ts` (garde-fous d'entrée écrits à la main, messages d'erreur en français, dans le style de `routes/quizzes.ts`), la variable de configuration et le câblage du démarrage.
- [ ] **Step 4: Lancer** `pnpm vitest run apps/server` puis `pnpm typecheck` ; attendu : PASS.
- [ ] **Step 5: Commit** `feat(server): synchronisation du catalogue et routes de la bibliothèque`.

### Task 5: Client API web et types `source`

**Files:**
- Create: `apps/web/src/api/library.ts`
- Modify: `apps/web/src/api/quizzes.ts` (champ `source: ContentSource | null` sur `Quiz` et `Question`, type `ContentSource` exporté)
- Test: `apps/web/src/api/library.test.ts`

**Interfaces:**
- Consumes: `apiGet`, `apiPost` de `./client` ; routes de la Task 4.
- Produces : types miroirs `Difficulty`, `Audience`, `LibraryQuestion`, `LibraryQuizSummary`, `LibraryFilters`, `LibraryMeta`, et les fonctions `getLibraryMeta()`, `listLibraryQuizzes(filters)`, `listLibraryQuestions(filters, page)`, `drawLibraryQuestions(filters, count, excludeIds)`, `duplicateLibraryQuiz(id): Promise<Quiz>`, `composeQuiz(title, questionIds): Promise<Quiz>`. Les filtres vides ne sont pas envoyés dans la query string.

- [ ] **Step 1: Écrire les tests** sur le modèle de `quizzes.test.ts` : chemin, méthode et corps de chaque fonction ; `listLibraryQuestions({ theme: 'cinema' }, { offset: 0, limit: 50 })` appelle `/api/library/questions?theme=cinema&offset=0&limit=50`.
- [ ] **Step 2: Lancer** `pnpm vitest run apps/web/src/api/library.test.ts` ; attendu : échec.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Lancer** le test et le typecheck du paquet web (nom dans `apps/web/package.json`) ; attendu : PASS.
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
- Onglet questions : champ de recherche, liste paginée (bouton « Afficher plus ») de questions avec case à cocher, type, énoncé, difficulté et `SourceCredit` ; champ « Tirer N questions au hasard » (1 à 50) et bouton « Tirer » qui ajoute à la sélection le résultat de `drawLibraryQuestions` en excluant la sélection courante. Si le tirage renvoie moins que demandé : `Seulement {n} questions disponibles avec ces filtres.` (`Seulement 1 question disponible avec ces filtres.` pour 1, `Aucune question disponible avec ces filtres.` pour 0).
- Panneau « Ma sélection ({n}) » : liste ordonnée, retrait possible, champ titre requis et bouton « Créer le quiz » désactivé si la sélection ou le titre est vide ; appelle `composeQuiz` puis navigue vers `/quizzes/:id`.
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
- [ ] **Step 2:** Démarrer l'application, vérifier dans les journaux les comptes de la synchronisation, ouvrir `/library`, dupliquer un quiz, composer un quiz par tirage et par sélection, vérifier l'attribution dans l'éditeur, lancer une partie et vérifier qu'aucune mention de source n'apparaît côté joueurs et grand écran.
- [ ] **Step 3:** Redémarrer avec `LIBRARY_EXTRA_DIR` pointant vers un dossier contenant un pack valide et un `themes.json` qui masque un thème : le pack apparaît, le thème disparaît. Rendre ensuite le pack invalide et redémarrer : l'erreur est journalisée, le serveur démarre, les questions du pack restent servies.
