# Nuage de mots : plan d'implémentation

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Objectif : ajouter le type de question `wordcloud`, où les participants envoient des mots courts au fil de l'eau et où le grand écran et l'hôte voient le nuage se construire en direct, avec modération par l'hôte et export.

Architecture : la règle métier (validation, normalisation, agrégation) vit dans `packages/quiz/src/wordcloud.ts` et sert au moteur comme au rapport. Le moteur (`packages/game`) accumule les mots dans l'unique réponse du joueur, désactive l'auto-révélation pour ce type et expose une projection agrégée. La passerelle diffuse cette projection, cadencée, à la seule room `viewersRoomName`. Les mots retirés vivent dans l'état moteur (clé : id de question) et dans une colonne durable `game_session.wordcloud_removed`.

Pile technique : TypeScript, zod 4, Fastify + Socket.IO, Drizzle/Postgres (tests sur base réelle via `startTestDb`), React + Vitest + Testing Library.

Spec : `docs/superpowers/specs/2026-11-01-nuage-de-mots-design.md`

## Contraintes globales

Ne jamais lancer `biome format --write` (dépôt non formaté Biome). `pnpm lint` et `pnpm typecheck` doivent sortir en code 0 avant chaque commit.

La diffusion en direct est réservée au type `wordcloud`. Aucun autre type ne change de comportement ; la répartition des autres types n'est jamais diffusée avant `question:reveal`.

Les téléphones ne reçoivent jamais le nuage : ni `wordcloud:update`, ni distribution de mots dans `question:reveal`.

Un mot fait 25 caractères au plus après nettoyage. Plafond : 20 mots par participant et par question.

Cadence de diffusion : 500 ms au plus entre deux `wordcloud:update` d'une même session, émission seulement après un changement.

Normalisation de fusion : `normalizeText(mot, false)` de `packages/quiz/src/text.ts`, après réduction des espaces internes multiples à un seul.

Pas de points, pas de bonne réponse : `is_correct = false`, `points = 0`.

Textes d'interface en français, apostrophe droite, pas de tiret cadratin.

## Points de vigilance

1. Un participant qui recharge sa page en pleine question perd l'affichage de ses mots, mais le serveur refuse toujours ses doublons ; l'acquittement de chaque envoi renvoie sa liste complète pour la reconstruire. Test dans la tâche 8.
2. Les variantes « Bonne  ambiance », « bonne ambiance » et « BONNE AMBIANCE » de joueurs différents comptent pour un seul mot, affiché dans sa graphie majoritaire. Test dans la tâche 1.
3. Le serveur redémarre en pleine question nuage : les mots retirés restent retirés (état moteur réhydraté, colonne DB). Test dans la tâche 4.
4. L'hôte retire un mot après la révélation (phase `reveal` ou `scoreboard`) : le retrait s'applique et l'export l'exclut. Test dans la tâche 3 et la tâche 5.
5. Une question nuage sans aucun mot reçu : le grand écran affiche un message vide propre, le rapport montre 0 participant sans planter. Tests dans les tâches 6 et 10.

---

### Tâche 1 : type `wordcloud` dans le registre et agrégation

Fichiers :
- Créer : `packages/quiz/src/wordcloud.ts`
- Modifier : `packages/quiz/src/types.ts` (union `QuestionType`), `packages/quiz/src/registry.ts`, `packages/quiz/src/index.ts`
- Test : `packages/quiz/src/wordcloud.test.ts`

Interfaces produites (exportées par `@splootlabs/quiz`) :

```ts
export const WORDCLOUD_MAX_WORD_LENGTH = 25
export const WORDCLOUD_MAX_WORDS_PER_PLAYER = 20
export type WordcloudPayload = Record<string, never>          // payload vide
export type WordcloudSubmission = { word: string }            // un envoi joueur (validateAnswer)
export type WordcloudAnswer = { words: string[] }             // réponse stockée, accumulée
export type WordcloudWord = { key: string; text: string; count: number }
export type WordcloudAggregate = { words: WordcloudWord[]; participants: number; totalWords: number }
export function wordKey(word: string): string
export function aggregateWords(answers: WordcloudAnswer[], removedKeys: ReadonlySet<string>): WordcloudAggregate
export const wordcloud: QuestionTypeDef<WordcloudPayload, WordcloudSubmission>
```

- [ ] Étape 1 : écrire les tests qui échouent dans `wordcloud.test.ts` :
  `validateAnswer` nettoie (`{ word: '  bonne   ambiance ' }` donne `{ word: 'bonne ambiance' }`), refuse une chaîne vide après nettoyage, refuse 26 caractères et accepte 25 ;
  `validatePayload({})` renvoie `{}` ;
  `isCorrect` vaut toujours `false` et `score` vaut toujours `0` ;
  `wordKey('Équipe')`, `wordKey('equipe')` et `wordKey('  EQUIPE ')` sont égales ;
  `aggregateWords([{ words: ['Bonne  ambiance'] }, { words: ['bonne ambiance', 'café'] }, { words: ['bonne ambiance'] }], new Set())` donne `participants: 3`, `totalWords: 4`, premier mot `{ text: 'bonne ambiance', count: 3 }` ;
  la graphie affichée est la plus fréquente, l'égalité départagée par ordre alphabétique (`localeCompare` en `fr`) ;
  tri par `count` décroissant puis `text` alphabétique ;
  un mot dont la clé est dans `removedKeys` n'apparaît pas et ne compte ni dans `totalWords` ni pour faire d'un joueur un participant (un joueur dont tous les mots sont retirés ne compte pas) ;
  `aggregateWords([], new Set())` donne `{ words: [], participants: 0, totalWords: 0 }`.
- [ ] Étape 2 : lancer `pnpm vitest run packages/quiz/src/wordcloud.test.ts`, attendu : échec (module absent).
- [ ] Étape 3 : implémenter `wordcloud.ts`. `wordKey` réduit les blancs (`/\s+/g` vers un espace) puis applique `normalizeText(…, false)`. Le schéma de réponse utilise `z.string().transform(nettoyage).pipe(z.string().min(1).max(25))`. `playerView` renvoie `{}`. Ajouter `'wordcloud'` à `QuestionType` et au registre ; exporter les symboles ci-dessus depuis `index.ts`.
- [ ] Étape 4 : relancer le test, attendu : succès. Lancer `pnpm --filter @splootlabs/quiz typecheck`, attendu : code 0.
- [ ] Étape 5 : commit `feat(quiz): type de question nuage de mots et agrégation`.

### Tâche 2 : base de données (enum, colonne des mots retirés)

Fichiers :
- Créer : `packages/db/drizzle/0020_wordcloud.sql`
- Modifier : `packages/db/drizzle/meta/_journal.json` (entrée `idx: 20`, `tag: "0020_wordcloud"`, `when: 1785419570313`, `breakpoints: true`), `packages/db/src/schema.ts` (enum ligne 11, table `gameSession`), `packages/db/src/repos/question.ts:8` (union du `CreateInput`), `packages/db/src/repos/session.ts`
- Test : `packages/db/src/repos/session.test.ts`

Contenu de la migration :

```sql
ALTER TYPE "public"."question_type" ADD VALUE 'wordcloud';--> statement-breakpoint
ALTER TABLE "game_session" ADD COLUMN "wordcloud_removed" jsonb DEFAULT '{}'::jsonb NOT NULL;
```

Interfaces produites :

```ts
// schema.ts, table gameSession
wordcloudRemoved: jsonb('wordcloud_removed').$type<Record<string, string[]>>().notNull().default({})
// repos/session.ts : écrase la liste des clés retirées pour UNE question (questionId → clés)
export async function setWordcloudRemoved(db: Db, sessionId: string, questionId: string, keys: string[]): Promise<void>
export async function loadWordcloudRemoved(db: Db, sessionId: string): Promise<Record<string, string[]>>
```

- [ ] Étape 1 : écrire le test qui échoue : après création d'une session, `loadWordcloudRemoved` renvoie `{}` ; `setWordcloudRemoved(db, s, 'q1', ['cafe'])` puis `setWordcloudRemoved(db, s, 'q2', ['x'])` donne `{ q1: ['cafe'], q2: ['x'] }` ; un second appel sur `q1` avec `['cafe', 'rush']` remplace la liste de `q1` sans toucher `q2` ; une question de type `'wordcloud'` peut être insérée via le repo `question`.
- [ ] Étape 2 : lancer `pnpm vitest run packages/db/src/repos/session.test.ts`, attendu : échec.
- [ ] Étape 3 : écrire la migration, le journal, le schéma et les deux fonctions. `setWordcloudRemoved` utilise `jsonb_set(wordcloud_removed, ARRAY[questionId], to_jsonb(keys))` pour une écriture atomique par question.
- [ ] Étape 4 : relancer le test, attendu : succès. Lancer aussi `pnpm vitest run packages/db/src/migrate.test.ts packages/db/src/schema.test.ts`, attendu : succès.
- [ ] Étape 5 : commit `feat(db): type wordcloud et colonne des mots retirés`.

### Tâche 3 : moteur de jeu

Fichiers :
- Modifier : `packages/game/src/state.ts`, `packages/game/src/engine.ts`, `apps/server/src/persistent-store.ts` (rien à reconvertir : clés string, vérifier seulement que `deserialize` conserve le champ)
- Test : `packages/game/src/engine.test.ts`

Interfaces :
- Consomme : `wordcloud`, `wordKey`, `aggregateWords`, `WORDCLOUD_MAX_WORDS_PER_PLAYER`, `WordcloudAnswer`, `WordcloudAggregate` (tâche 1).
- Produit :

```ts
// state.ts, GameSession : optionnel pour lire les états sérialisés avant la migration
wordcloudRemoved?: Record<string, string[]>   // id de question → clés retirées
// engine.ts
export type SubmitAnswerResult = { accepted: boolean; reason?: string; words?: string[] }
export type WordcloudView = WordcloudAggregate & { questionId: string; truncated: boolean }
export const WORDCLOUD_VIEW_LIMIT = 100
// Engine
wordcloudView(session: Readonly<GameSession>): WordcloudView | null    // null si la question courante n'est pas un nuage
removeWord(sessionId: string, word: string): Promise<{ session: GameSession; questionId: string; removedKeys: string[] }>
```

Comportement attendu pour la question courante de type `wordcloud`, sans changement pour les autres types :
`submitAnswer` accepte des envois successifs ; le premier fixe `timeMs` ; chaque envoi ajoute le mot nettoyé à `answer.words` et renvoie `words` (liste complète) ; refus `'mot déjà envoyé'` si sa clé existe déjà parmi les mots du joueur ; refus `'limite de 20 mots atteinte'` au 21e ; `correct: false`, `points: 0`. Un mot retiré renvoyé est accepté normalement (filtré à l'agrégation).
`allConnectedAnswered` renvoie `false`.
`wordcloudView` agrège via `aggregateWords` avec les clés retirées de la question, coupe `words` aux 100 premiers et pose `truncated` ; `participants` et `totalWords` restent calculés sur l'ensemble.
`removeWord` accepte les phases `question`, `reveal` et `scoreboard` (sinon lève `'retrait impossible hors question nuage de mots'`), ajoute `wordKey(word)` sans doublon et sauve via `store.save`.
`questionResult` renvoie `{ correct: null, distribution: {} }`.

- [ ] Étape 1 : écrire les tests qui échouent, avec une `wordcloudQuestion` (`type: 'wordcloud'`, `payload: {}`) : trois envois du même joueur acceptés, `words` renvoyé de longueur 3, `timeMs` du premier conservé ; doublon `'Café'` après `'cafe'` refusé ; 21e mot refusé ; `allConnectedAnswered` reste `false` quand tous les joueurs connectés ont envoyé un mot ; `wordcloudView` après `removeWord('CAFÉ')` n'a plus `cafe` et `totalWords` diminue ; un mot retiré puis renvoyé par un autre joueur reste absent ; `removeWord` fonctionne en phase `reveal` et lève en `lobby` ; `questionResult` vaut `{ correct: null, distribution: {} }` ; 150 mots distincts donnent `words.length === 100` et `truncated === true` ; `reveal` ne change aucun score ; une question `mcq` refuse toujours une seconde réponse (non-régression).
- [ ] Étape 2 : lancer `pnpm vitest run packages/game/src/engine.test.ts`, attendu : échec sur les nouveaux tests.
- [ ] Étape 3 : implémenter. Dans `submitAnswer`, garder l'absence d'`await` entre `peek` et `store.recordAnswer` (atomicité sur la boucle d'événements) ; l'accumulation construit un nouveau `SubmittedAnswer` puis le passe à `recordAnswer`, qui écrase l'entrée.
- [ ] Étape 4 : relancer, attendu : succès. `pnpm --filter @splootlabs/game typecheck`, attendu : code 0.
- [ ] Étape 5 : commit `feat(game): accumulation des mots et projection du nuage`.

### Tâche 4 : passerelle temps réel

Fichiers :
- Modifier : `apps/server/src/game-gateway.ts`
- Test : créer `apps/server/src/wordcloud-e2e.test.ts` (reprendre `buildApp`, `signUp`, `connectClient` et le seeding de `game-e2e.test.ts`)

Interfaces :
- Consomme : `engine.wordcloudView`, `engine.removeWord`, `SubmitAnswerResult.words` (tâche 3) ; `setWordcloudRemoved` (tâche 2).
- Produit (contrat du fil, consommé par les tâches 6 à 9) :
  événement serveur `wordcloud:update`, charge `WordcloudView`, émis vers `viewersRoomName(sessionId)` uniquement ;
  événement hôte `host:wordcloudRemove`, charge `{ word: string }`, acquittement `{ ok: true }` ou `{ error: string }` ;
  acquittement de `player:answer` pour un nuage : `{ accepted: true, words: string[] }`.

Comportement :
Nouvelle constante `WORDCLOUD_BROADCAST_INTERVAL_MS = 500` et deux champs de `SessionMeta` (`wordcloudBroadcastTimeout`, `lastWordcloudBroadcastAt`), sur le modèle de `scheduleLobbyBroadcast`. `scheduleWordcloudBroadcast(sessionId, meta)` émet tout de suite si l'intervalle est écoulé, sinon planifie une seule émission à l'échéance. `flushWordcloudBroadcast(sessionId, meta)` annule l'attente et émet immédiatement.
Dans `player:answer`, pour un nuage : `screen:progress` n'est émis que si `result.words.length === 1` (premier mot du joueur), puis `scheduleWordcloudBroadcast`. L'auto-révélation reste en place mais ne se déclenche plus grâce à `allConnectedAnswered`.
`host:wordcloudRemove` : `requireHost`, `engine.removeWord`, puis `setWordcloudRemoved` dans `withTenantTx` (tenant de `meta`), puis `flushWordcloudBroadcast`, puis acquittement.
`doRevealBySession` : pour un nuage, `flushWordcloudBroadcast` juste avant `question:reveal`.
Rejeu : `screen:join`, `screen:reconnect` et `emitReconnectSnapshot` (hôte) émettent `wordcloud:update` à CE socket quand `engine.wordcloudView(session)` n'est pas null et que la phase est `question`, `reveal` ou `scoreboard`. Ne pas l'ajouter à `replayCurrentQuestionTo`, partagé avec les joueurs.
Nettoyage du minuteur : `startQuestionFlow`, `evictSessionMemory` et `sweepAbandonedSessions`, comme `clearLobbyBroadcastTimeout`.

- [ ] Étape 1 : écrire les tests e2e qui échouent : un hôte, un grand écran, deux joueurs, un quiz `[wordcloud, mcq]` ; trois envois du joueur A en moins de 500 ms produisent au plus deux `wordcloud:update` côté écran et le dernier contient les trois mots ; aucun socket joueur ne reçoit `wordcloud:update` ; `screen:progress` arrive une fois par joueur ; après un mot de chacun, aucun `question:reveal` n'arrive dans les 600 ms ; `host:wordcloudRemove { word: 'CAFE' }` produit aussitôt un `wordcloud:update` sans `cafe` et `game_session.wordcloud_removed` en base contient `{ [questionId]: ['cafe'] }` ; `host:wordcloudRemove` venant d'un socket joueur est refusé ; un grand écran qui fait `screen:reconnect` en pleine question reçoit `wordcloud:update` ; après `host:reveal`, `answer_record` contient une ligne par joueur avec `answer.words`, `is_correct = false`, `points = 0` ; la question `mcq` suivante se comporte comme avant (auto-révélation quand les deux ont répondu).
  Ajouter le test de redémarrage (point de vigilance 3) dans `persistent-store.test.ts` : une session sérialisée avec `wordcloudRemoved: { q1: ['cafe'] }` relue par un store neuf conserve le champ.
- [ ] Étape 2 : lancer `pnpm vitest run apps/server/src/wordcloud-e2e.test.ts apps/server/src/persistent-store.test.ts`, attendu : échec.
- [ ] Étape 3 : implémenter.
- [ ] Étape 4 : relancer, attendu : succès. Lancer aussi `pnpm vitest run apps/server/src/game-e2e.test.ts apps/server/src/game-gateway.test.ts`, attendu : succès (non-régression).
- [ ] Étape 5 : commit `feat(server): diffusion cadencée du nuage et retrait par l'hôte`.

### Tâche 5 : rapport de partie et export CSV

Fichiers :
- Modifier : `packages/db/package.json` (dépendance `"@splootlabs/quiz": "workspace:*"`, puis `pnpm install`), `packages/db/src/repos/reports.ts`, `apps/server/src/routes/sessions.ts`
- Test : `packages/db/src/repos/reports.test.ts`, `apps/server/src/reports-e2e.test.ts`

Interfaces produites :

```ts
// SessionReport['questions'][number]
correctCount: number | null      // null pour un nuage
avgTimeMs: number | null         // null pour un nuage
wordcloud: { participants: number; totalWords: number; words: { text: string; count: number }[] } | null
```

Comportement :
Côté joueurs, `correctCount` et `answerCount` ne comptent que les `answer_record` dont la question n'est pas de type `wordcloud` (jointure sur `question`).
Côté questions, pour chaque question `wordcloud`, lire les `answer.words` de la session et `loadWordcloudRemoved`, puis `aggregateWords` ; la liste complète va dans `wordcloud.words`.
CSV : la ligne d'un nuage dans la section « Questions » met `participants` dans « Réponses données » et laisse vides « Réponses correctes » et « Temps moyen (ms) ». Après la section « Questions », une section par nuage : ligne titre `Nuage de mots : <énoncé>`, en-têtes `Mot`, `Occurrences`, une ligne par mot dans l'ordre de `aggregateWords`.

- [ ] Étape 1 : écrire les tests qui échouent : partie avec un nuage (A : `café`, `rush` ; B : `Café`) et un QCM réussi par A ; le joueur A a `answerCount: 1`, `correctCount: 1` ; la ligne nuage a `correctCount: null`, `avgTimeMs: null`, `wordcloud.words[0]` égal à `{ text: 'café', count: 2 }` ; après `setWordcloudRemoved(…, ['rush'])`, `rush` disparaît ; un nuage sans réponse donne `{ participants: 0, totalWords: 0, words: [] }` ; le CSV contient la ligne `Nuage de mots : <énoncé>` suivie de `Mot;Occurrences` (séparateur réel de `toCsv`) et de `café;2`.
- [ ] Étape 2 : lancer `pnpm vitest run packages/db/src/repos/reports.test.ts apps/server/src/reports-e2e.test.ts`, attendu : échec.
- [ ] Étape 3 : implémenter.
- [ ] Étape 4 : relancer, attendu : succès. `pnpm typecheck`, attendu : code 0.
- [ ] Étape 5 : commit `feat(reports): nuages de mots exclus des statistiques et exportés`.

### Tâche 6 : socle web (types, contrat, composant `WordCloud`)

Fichiers :
- Créer : `apps/web/src/ui/WordCloud.tsx`, `apps/web/src/ui/WordCloud.test.tsx`
- Modifier : `apps/web/src/api/quizzes.ts:21` (`QuestionType`), `apps/web/src/api/sessions.ts` (champs de la tâche 5), `apps/web/src/realtime/contracts.ts` (interface `WordcloudView` identique au fil), `apps/web/src/realtime/distribution.ts` (`QuestionKind` et `case 'wordcloud': return []`), feuille de style du thème existante pour les classes `.wordcloud*`

Interfaces produites :

```tsx
export function WordCloud(props: {
  words: { key: string; text: string; count: number }[]
  onRemove?: (word: { key: string; text: string }) => void   // présent sur HostLive seulement
  emptyLabel?: string                                       // défaut « En attente des premières idées… »
}): JSX.Element
```

Disposition en flux centré (`flex-wrap`), cinq paliers de taille calculés par `Math.ceil(5 * count / maxCount)`, classes `wordcloud__word--t1` à `--t5`. Avec `onRemove`, chaque mot porte un bouton `aria-label="Retirer « <texte> »"`. La liste est une `ul` avec `aria-label="Nuage de mots"` ; le nombre d'occurrences est lisible par lecteur d'écran.

- [ ] Étape 1 : écrire les tests qui échouent : le mot le plus fréquent porte `--t5` et un mot à 1 sur 10 porte `--t1` ; sans `onRemove`, aucun bouton ; avec `onRemove`, cliquer sur « Retirer « café » » appelle le rappel avec `{ key: 'cafe', text: 'café' }` ; liste vide affiche `emptyLabel`.
- [ ] Étape 2 : lancer `pnpm vitest run apps/web/src/ui/WordCloud.test.tsx`, attendu : échec.
- [ ] Étape 3 : implémenter le composant et compléter les types.
- [ ] Étape 4 : relancer, attendu : succès. `pnpm --filter @splootlabs/web typecheck` (nom de paquet réel à vérifier dans `apps/web/package.json`), attendu : code 0 ; les `switch` exhaustifs de `HostEditor` signaleront les cas manquants, traités à la tâche 7.
- [ ] Étape 5 : commit `feat(web): composant WordCloud et contrat wordcloud:update`.

### Tâche 7 : éditeur et libellés

Fichiers :
- Modifier : `apps/web/src/screens/HostEditor.tsx` (`TYPE_LABEL` ligne 42, interface `WordcloudQuestion` et union `Question`, `fromApiQuestion`, `toQuestionPatch`, `defaultCreateInput`, `hasTypeSpecificData`, `validationError`, `fieldErrors`, `<select id="q-type">`), `apps/web/src/screens/Library.tsx:40`, `apps/web/src/screens/LibraryPreview.tsx:8`
- Test : `apps/web/src/screens/HostEditor.test.tsx`

Valeurs : libellé `Nuage de mots` partout ; option `<option value="wordcloud">Nuage de mots</option>` en dernier ; payload `{}` ; `hasTypeSpecificData` faux ; aucune erreur propre au type ; le panneau de l'éditeur affiche à la place des réponses le texte « Les participants proposent leurs idées en direct. Pas de bonne réponse ni de points. »

- [ ] Étape 1 : écrire le test qui échoue : choisir « Nuage de mots » dans le sélecteur crée une question `{ type: 'wordcloud', payload: {} }` (appel `createQuestion` simulé) et affiche le texte explicatif ; la question n'est pas marquée incomplète.
- [ ] Étape 2 : lancer `pnpm vitest run apps/web/src/screens/HostEditor.test.tsx`, attendu : échec.
- [ ] Étape 3 : implémenter.
- [ ] Étape 4 : relancer, attendu : succès ; `pnpm typecheck`, attendu : code 0.
- [ ] Étape 5 : commit `feat(editor): création de questions nuage de mots`.

### Tâche 8 : écran du participant

Fichiers :
- Créer : `apps/web/src/screens/PlayerWordcloud.tsx`, `apps/web/src/screens/PlayerLive.wordcloud.test.tsx`
- Modifier : `apps/web/src/screens/PlayerLive.tsx` (`QuestionKind` ligne 23, rendu de la phase `question`, `hasSubmission`, phase `result`)

Interfaces :
- Consomme : acquittement `{ accepted, reason?, words? }` de `player:answer` (tâche 4), constantes de la tâche 1.
- Produit : `PlayerWordcloud(props: { disabled: boolean; submit: (word: string) => Promise<{ accepted: boolean; reason?: string; words?: string[] }> }): JSX.Element`.

Comportement : champ (`maxLength={25}`, placeholder « Un mot ou deux »), bouton « Envoyer », aide « 25 caractères max, jusqu'à 20 idées ». Envoi accepté : champ vidé, liste « Tes idées envoyées » remplacée par `words` de l'acquittement, focus rendu au champ. Refus : message `reason` dans une zone `role="alert"`, champ conservé. Pour ce type, `PlayerLive` reste en phase `question` après un envoi (pas de passage à `answered`). À la fin du chrono, phase `answered` avec « Temps écoulé, merci pour tes idées ». En phase `result`, un verdict neutre « Merci pour tes idées » (pas de « Résultat indisponible », pas de bon ou mauvais).

- [ ] Étape 1 : écrire les tests qui échouent (socket simulée comme dans `PlayerLive.reading.test.tsx`) : deux envois successifs restent en phase question et la liste affiche les deux mots ; un refus `'mot déjà envoyé'` s'affiche en alerte ; après une reconnexion (liste locale vide), un envoi accepté dont l'acquittement porte `words: ['a', 'b', 'c']` affiche les trois mots (point de vigilance 1) ; `question:reveal` affiche « Merci pour tes idées ».
- [ ] Étape 2 : lancer `pnpm vitest run apps/web/src/screens/PlayerLive.wordcloud.test.tsx`, attendu : échec.
- [ ] Étape 3 : implémenter.
- [ ] Étape 4 : relancer, puis tous les tests `PlayerLive.*`, attendu : succès.
- [ ] Étape 5 : commit `feat(player): envoi des idées au fil de l'eau`.

### Tâche 9 : grand écran et écran hôte

Fichiers :
- Modifier : `apps/web/src/screens/BigScreen.tsx` (abonnement `wordcloud:update`, `renderLiveAnswers`, révélation), `apps/web/src/screens/HostLive.tsx` (abonnement, rendu, retrait)
- Test : `apps/web/src/screens/BigScreen.wordcloud.test.tsx`, `apps/web/src/screens/HostLive.wordcloud.test.tsx`

Comportement : pour une question `wordcloud`, l'état `wordcloud: WordcloudView | null` est remis à `null` à chaque `question:show` dont l'`id` change. Pendant `question` et `reveal`, le grand écran rend `WordCloud` puis la ligne « N participants ont proposé, M mots reçus » ; si `truncated`, ajouter « (100 mots les plus cités) ». En révélation, pas de tableau de répartition pour ce type. `HostLive` rend la même chose avec `onRemove`, qui émet `host:wordcloudRemove { word: text }` et affiche l'erreur d'acquittement éventuelle avec le mécanisme existant de `runHostAction`.

- [ ] Étape 1 : écrire les tests qui échouent : le grand écran affiche les mots d'un `wordcloud:update` et les compteurs ; un nouveau `question:show` efface l'ancien nuage ; un nuage vide affiche « En attente des premières idées… » (point de vigilance 5) ; sur `HostLive`, cliquer sur « Retirer « café » » émet `host:wordcloudRemove` avec `{ word: 'café' }` ; un `question:show` de type `mcq` garde le rendu actuel.
- [ ] Étape 2 : lancer les deux fichiers de test, attendu : échec.
- [ ] Étape 3 : implémenter.
- [ ] Étape 4 : relancer, puis `BigScreen.*` et `HostLive.*`, attendu : succès.
- [ ] Étape 5 : commit `feat(live): nuage en direct sur le grand écran et modération hôte`.

### Tâche 10 : page de rapport

Fichiers :
- Modifier : `apps/web/src/screens/SessionReport.tsx` (tableau des questions, ligne 249)
- Test : créer `apps/web/src/screens/SessionReport.test.tsx` si absent

Comportement : pour une ligne dont `wordcloud` n'est pas null, la colonne « Taux de réussite » affiche « Nuage de mots, N participants », suivi des quatre premiers mots de `wordcloud.words` au format « café (2) », séparés par des virgules ; si aucun mot, « Aucune idée proposée ». Les autres lignes sont inchangées.

- [ ] Étape 1 : écrire le test qui échoue : rapport simulé avec un nuage de six mots, seuls les quatre premiers apparaissent dans l'ordre reçu ; nuage vide affiche « Aucune idée proposée » ; une ligne QCM garde son taux.
- [ ] Étape 2 : lancer `pnpm vitest run apps/web/src/screens/SessionReport.test.tsx`, attendu : échec.
- [ ] Étape 3 : implémenter.
- [ ] Étape 4 : relancer, attendu : succès. Puis vérification complète : `pnpm lint`, `pnpm typecheck`, `pnpm test`, tous en code 0.
- [ ] Étape 5 : commit `feat(report): top 4 des idées dans le rapport de partie`.
