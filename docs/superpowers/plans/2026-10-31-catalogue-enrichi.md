# Catalogue enrichi : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** enrichir le catalogue de la bibliothèque (nouvelles catégories OpenQuizzDB, traductions dans les deux sens, quiz thématiques, mix et par décennie) sans toucher à l'application.

**Architecture:** tout se passe dans `packages/library`. Les packs OpenQuizzDB sont régénérés par `scripts/convert-openquizzdb.ts`, étendu (nouvelles catégories, gel du livré, exclusions, surcharges de thème, quiz composés à partir d'une liste de questions) et piloté par un fichier de données `scripts/openquizzdb-plans.ts`. Open Trivia DB est retouché par un nouveau script idempotent qui part des fichiers livrés. Les traductions sont des tables JSON versionnées dans `packages/library/translations/`, appliquées par une fonction pure testée (`src/translate.ts`) et un script qui produit des packs miroirs `catalog/<source>-<langue>/`.

**Tech Stack:** TypeScript, zod, vitest, scripts lancés par `pnpm dlx tsx`.

**Spec:** `docs/superpowers/specs/2026-10-31-catalogue-enrichi-design.md`

## Global Constraints

- Aucun changement hors de `packages/library` et `docs/` : ni schéma de pack, ni base, ni serveur, ni écran.
- Quiz de 10 à 20 questions ; 20 visé pour les mix et les quiz par décennie.
- QCM à 4 propositions, une seule bonne réponse ; propositions de 25 caractères au plus dans tout pack en français et dans tout pack traduit (les originaux anglais d'Open Trivia DB en sont dispensés).
- Pas d'énoncé en double (normalisé) dans une même langue, identifiants uniques et stables : une question livrée garde son identifiant et son texte.
- Identifiant d'une traduction : identifiant d'origine + `-en` ou `-fr` ; source : nom d'origine + ` (traduction Sploot Labs)`, même licence, même lien.
- Thèmes ajoutés : `{ "id": "television", "label": "Télévision" }` et `{ "id": "people", "label": "Célébrités" }`.
- Thème des quiz mix et par décennie : `culture-generale`. Décennies visées : années 70, 80, 90, 2000, 2010 ; pas de quiz pour une décennie sans 15 bonnes questions d'une même famille de source, pas de question rédigée pour combler.
- Quiz par décennie en français : questions OpenQuizzDB uniquement.
- Les 21 quiz composés OpenQuizzDB livrés ne sont pas démontés ; les nouveaux quiz puisent dans les questions libres. Les 6 quiz anglais d'Open Trivia DB sont remplacés.
- Ordre des questions des mix et des quiz par décennie : mélangé une fois par un tirage (pas à la main), puis figé dans le fichier de plans.
- Textes produits (titres, descriptions, traductions françaises) : casse de phrase, guillemets « », apostrophe droite, pas de tiret cadratin ni demi-cadratin.
- Relecture des traductions : une seconde passe de Claude, sans relecture humaine.
- Caches de téléchargement hors du dépôt : `D:\Source\pengou-cache\openquizzdb`. Ne jamais relancer `convert-opentdb.ts`.
- CI : `pnpm lint`, `pnpm typecheck`, `pnpm test` passent. Ne jamais lancer `biome format --write`.

## Review Focus

1. Une question livrée modifiée ou disparue au retéléchargement d'OpenQuizzDB : le script doit échouer en nommant l'identifiant, jamais réécrire en silence (Task 1, étape de gel).
2. Une traduction dont la bonne réponse n'est plus à la même place que dans l'original, ou dont le nombre de propositions diffère : test de cohérence original/traduction (Task 5).
3. Une table de traduction incomplète ou périmée (question sans entrée, entrée sans question) : le script échoue et liste les identifiants (Task 5).
4. Une traduction anglaise identique à une question d'Open Trivia DB déjà présente : le test de doublons par langue la détecte, la table la marque `skip` (Task 7).
5. Une question datée (« actuel », « dernier », record, âge) mal rangée dans un quiz par décennie : la revue de Task 2 note la décennie à partir du fait évoqué, et la Task 3 ne prend que des questions notées d'une seule décennie.

---

### Task 0: Branche et spec

**Files:**
- Create: `docs/superpowers/specs/2026-10-31-catalogue-enrichi-design.md` (déjà écrit), `docs/superpowers/plans/2026-10-31-catalogue-enrichi.md`

- [ ] **Step 1:** vérifier `git branch --show-current` = `feat/catalogue-enrichi` (créée depuis `origin/main`).
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-31-catalogue-enrichi-design.md docs/superpowers/plans/2026-10-31-catalogue-enrichi.md
git commit -m "docs: conception et plan du catalogue enrichi"
```

### Task 1: Conversion OpenQuizzDB étendue et gelée

**Files:**
- Modify: `packages/library/catalog/themes.json`
- Create: `packages/library/scripts/openquizzdb-plans.ts`
- Modify: `packages/library/scripts/convert-openquizzdb.ts`
- Modify (généré) : `packages/library/catalog/openquizzdb/**`

**Interfaces:**
- Produces (`openquizzdb-plans.ts`) :
  - `export type QuizPlan = { slug: string; title: string; theme: string; description?: string; sources?: number[]; questions?: string[] }` (exactement un des deux, `sources` = quiz source entiers comme aujourd'hui, `questions` = identifiants dans l'ordre du quiz).
  - `export const QUIZZES: QuizPlan[]` (les 21 plans actuels déplacés tels quels).
  - `export const EXCLUDED: Record<string, string>` (identifiant de question vers motif).
  - `export const QUESTION_THEME: Record<string, string>` (identifiant vers thème, prime sur la catégorie).
  - `export const ADULT_QUESTIONS: string[]` (questions isolées pour adultes, en plus de `ADULT_QUIZZES`).

- [ ] **Step 1:** ajouter les deux thèmes à `themes.json`, puis `CATEGORY_THEME.TELEVISION = 'television'` et `CATEGORY_THEME.CELEBRITES = 'people'` ; retirer ces deux catégories du commentaire des catégories écartées.
- [ ] **Step 2:** déplacer `QUIZZES` dans `openquizzdb-plans.ts` avec les nouveaux exports (vides au départ) ; le convertisseur les importe.
- [ ] **Step 3: gel du livré.** Avant le `rm`, lire tous les packs de `catalog/openquizzdb/**` en une `Map<id, { prompt, options }>`. Amorcer `seenPrompts` avec leurs énoncés normalisés (le livré gagne le dédoublonnage quel que soit le numéro de quiz source). Après conversion, échouer (`throw`, message listant les identifiants) si une question livrée hors `EXCLUDED` manque ou si son énoncé ou ses propositions diffèrent. Échouer aussi si un quiz source livré est absent de la liste en ligne.
- [ ] **Step 4:** appliquer `EXCLUDED` (question retirée, motif journalisé), `QUESTION_THEME` et `ADULT_QUESTIONS` dans `convertQuestion` ou juste après. Les plans à `questions` prennent leurs questions où qu'elles soient (hors autres quiz composés : erreur si une question est déjà utilisée) ; le contrôle « hors thème » ne s'applique qu'aux plans à `sources` ; source du pack : rédacteur commun ou `OpenQuizzDB, plusieurs auteurs` comme aujourd'hui ; description par défaut pour un plan à `questions` : `D'après des questions OpenQuizzDB de <rédacteurs>.` si `description` est absente.
- [ ] **Step 5:** mettre à jour le texte de `licenseFile` : la section Modifications mentionne le retrait de questions dépassées ou erronées (liste dans `scripts/openquizzdb-plans.ts`), les reclassements de thème et les quiz composés à partir de questions choisies.
- [ ] **Step 6: Run**

```bash
pnpm dlx tsx packages/library/scripts/convert-openquizzdb.ts --cache D:/Source/pengou-cache/openquizzdb
```

Expected : fin sans erreur, environ 56 quiz source de plus que la conversion livrée. `git diff --stat packages/library/catalog/openquizzdb` ne montre que des fichiers `quiz/NNNN.json` ajoutés et le `LICENSE.md` modifié (aucun fichier livré modifié).

- [ ] **Step 7:** `pnpm vitest run packages/library` : PASS (les nouveaux thèmes sont utilisés).
- [ ] **Step 8: Commit** `feat(library): catégories Télévision et Célébrités d'OpenQuizzDB, gel des questions livrées`

### Task 2: Revue du contenu français

Travail de contenu, en lots confiés à des sous-agents (par exemple 150 questions par lot), sur toutes les questions OpenQuizzDB françaises.

**Files:**
- Modify: `packages/library/scripts/openquizzdb-plans.ts` (`EXCLUDED`, `QUESTION_THEME`, `ADULT_QUESTIONS`)
- Create (hors dépôt) : fiches de revue dans le dossier scratchpad de la session, un JSON par lot.

**Interfaces:**
- Produces : fiche de revue, un tableau de `{ id: string; verdict: 'ok' | 'exclure'; motif?: string; theme?: string; adulte?: boolean; decennie?: '1970' | '1980' | '1990' | '2000' | '2010' }`. `decennie` n'est renseignée que si la question évoque sans ambiguïté un fait, une œuvre ou une personne marquante d'une seule décennie (date de sortie ou d'apogée).

- [ ] **Step 1:** extraire la liste des questions (id, thème, énoncé, propositions, bonne réponse, quiz composé éventuel) dans le scratchpad et la découper en lots.
- [ ] **Step 2:** chaque sous-agent remplit la fiche de son lot. Motifs d'exclusion : fait dépassé ou faux en 2026 (« actuel », « dernier », records, âges, titres en cours), réponse ambiguë, question incompréhensible hors contexte. Signaler les thèmes erronés (exemple connu : `oqdb-0027-3`, Toad, va en `jeux-video`).
- [ ] **Step 3:** reporter les verdicts dans les trois exports. Vérifier qu'aucun quiz composé livré ne descend sous 10 questions ; sinon garder la question la moins gênante et noter le choix dans le motif.
- [ ] **Step 4:** relancer la conversion (commande de Task 1) puis `pnpm vitest run packages/library` : PASS.
- [ ] **Step 5: Commit** `fix(library): retrait des questions dépassées et reclassement de thèmes OpenQuizzDB`

### Task 3: Quiz français thématiques, mix et par décennie

**Files:**
- Modify: `packages/library/scripts/openquizzdb-plans.ts` (`QUIZZES`)
- Create (hors dépôt) : `shuffle.mjs` dans le scratchpad, tirage aléatoire d'une liste d'identifiants (Fisher-Yates, `crypto.randomInt`).

- [ ] **Step 1: thématiques.** Plans à `questions` (ou à `sources` si un quiz source entier convient) pour arriver à au moins deux quiz français par thème, `jeux-video` excepté s'il manque de matière (couvert par les traductions d'Open Trivia DB). Priorité : `television`, `people`, `art`, `litterature`, `sciences`, `histoire`. Slugs en kebab-case, titres en casse de phrase.
- [ ] **Step 2: mix.** Une dizaine de quiz de 20 questions, au moins 4 thèmes chacun, aucun thème au-dessus de 6 questions ; titres `Mix culture #1`, `Mix culture #2`, etc. Ordre tiré par `shuffle.mjs`.
- [ ] **Step 3: décennies.** Pour chaque décennie, les questions notées de cette décennie en Task 2 et libres ; un quiz `Les années 80` (etc.) de 15 à 20 questions si au moins 15 conviennent, deux si la matière dépasse 35 ; ordre tiré par `shuffle.mjs`. Description : `Télévision, musique, cinéma et célébrités des années 80.` adaptée au contenu réel.
- [ ] **Step 4:** relancer la conversion puis `pnpm vitest run packages/library` : PASS.
- [ ] **Step 5: Commit** `feat(library): quiz thématiques, mix et par décennie en français`

### Task 4: Retouche d'Open Trivia DB

**Files:**
- Create: `packages/library/scripts/curate-opentdb.ts`, `packages/library/scripts/opentdb-plans.ts`
- Modify (généré) : `packages/library/catalog/opentdb/*.json`, `packages/library/catalog/opentdb/LICENSE.md`

**Interfaces:**
- Produces (`opentdb-plans.ts`) : `EXCLUDED: Record<string, string>`, `QUESTION_THEME: Record<string, string>`, `QUIZZES: { slug: string; title: string; theme: string; description?: string; questions: string[] }[]`.
- Le script lit `catalog/opentdb/*.json`, retire `EXCLUDED`, applique `QUESTION_THEME` (une question qui change de thème change de fichier), remplace tous les quiz par `QUIZZES` (id `otdb-quiz-<slug>`, langue `en`, difficulté = la plus fréquente parmi ses questions, public `tous`), réécrit les fichiers triés comme `convert-opentdb.ts`, puis appelle `readCatalog`. Il est idempotent : le relancer sans changer les plans ne modifie aucun fichier. Une question d'un quiz absente du catalogue fait échouer le script.

- [ ] **Step 1:** écrire le script et les plans vides ; le lancer : `git diff` vide sauf les quiz retirés.
- [ ] **Step 2: revue** des 1 149 questions par lots de sous-agents, même fiche qu'en Task 2 plus `traduisible: boolean` et `motifNonTraduisible?: string` (football américain, séries et politique des États-Unis sans écho en France, jeux de mots, questions sur la langue anglaise). Reporter `EXCLUDED` et `QUESTION_THEME`.
- [ ] **Step 3: quiz anglais.** Remplacer les 6 quiz par des quiz choisis : au moins un par thème, quelques mix (`Culture mix #1`...), et des quiz par décennie si la matière le permet (règle des 15 questions). Choisir de préférence des questions `traduisible` : un quiz dont toutes les questions sont traduites aura son miroir français.
- [ ] **Step 4:** mettre à jour `LICENSE_FILE` du dossier (retraits, reclassements, quiz choisis à la main, script `curate-opentdb.ts`) ; ajouter en tête de `convert-opentdb.ts` un commentaire : ne plus relancer, cache perdu, voir `curate-opentdb.ts`.
- [ ] **Step 5:** lancer deux fois le script : le second passage ne change rien (`git status` identique). `pnpm vitest run packages/library` : PASS.
- [ ] **Step 6: Commit** `feat(library): retouche d'Open Trivia DB et nouveaux quiz anglais`

### Task 5: Outil de traduction

**Files:**
- Create: `packages/library/src/translate.ts`, `packages/library/src/translate.test.ts`
- Create: `packages/library/scripts/translate-catalog.ts`
- Create: `packages/library/translations/LICENSE.md`
- Modify: `packages/library/src/catalog.test.ts`

**Interfaces:**
- Produces (`src/translate.ts`, non exporté par `index.ts`) :

```ts
export type QuestionTranslation = { prompt: string; options?: string[] } | { skip: string }
export type TranslationTable = {
  questions: Record<string, QuestionTranslation>
  quizzes: Record<string, { title: string; description?: string }>
}
export type TranslateResult = { pack: Pack | null; missing: string[]; skippedQuizzes: string[] }
export function mergeTables(tables: TranslationTable[]): TranslationTable // lève sur une clé en double
export function translatePack(pack: Pack, table: TranslationTable, lang: string): TranslateResult
```

`options` suit l'ordre des propositions de l'original ; `correct` est recopié de l'original. Vrai/faux : `options` absent, payload recopié. Pack sans aucune question traduite : `pack: null`.

- CLI : `pnpm dlx tsx packages/library/scripts/translate-catalog.ts --from <dossier source> --to <langue>` lit `catalog/<from>/**`, fusionne `translations/<from>-<to>/*.json`, écrit `catalog/<from>-<to>/` (même arborescence, dossier vidé d'abord) et son `LICENSE.md` (source d'origine, lien, licence CC BY-SA 4.0, mention « traduction par Sploot Labs, assistée par IA », liste des modifications). Échoue si une question n'a pas d'entrée (`missing`) ou si une entrée ne correspond à aucune question ; journalise les quiz non reproduits.

- [ ] **Step 1: tests qui échouent** dans `src/translate.test.ts` :
  - `traduit un QCM en gardant la place de la bonne réponse` : pack d'une question `q1` (options A, B vraie, C, D) et table `{ q1: { prompt: 'P', options: ['a','b','c','d'] } }` donnent `q1-en`, `language: 'en'`, `options[1]` = `{ label: 'b', correct: true }`, source `X (traduction Sploot Labs)`.
  - `recopie le payload d'un vrai/faux`.
  - `écarte une question marquée skip et ne reproduit pas son quiz` : `skippedQuizzes` contient l'id du quiz.
  - `reproduit un quiz entièrement traduit` : id `<quiz>-en`, titre de la table, `questionIds` suffixés.
  - `liste les questions sans entrée` dans `missing`.
  - `lève si le nombre de propositions diffère`.
  - `mergeTables lève sur une clé en double`.
- [ ] **Step 2:** `pnpm vitest run packages/library/src/translate.test.ts` : FAIL (module absent).
- [ ] **Step 3:** implémenter `src/translate.ts`, puis le script CLI et `translations/LICENSE.md` (les tables sont une adaptation CC BY-SA 4.0 des sources ; hors licence Apache-2.0).
- [ ] **Step 4:** `pnpm vitest run packages/library/src/translate.test.ts` : PASS.
- [ ] **Step 5:** ajouter à `catalog.test.ts` le test `chaque traduction garde le type, le nombre de propositions et la bonne réponse de son original` : pour toute question dont l'id finit par `-en` ou `-fr` et dont l'original (id sans suffixe) existe, mêmes `type`, même nombre d'options, même index de bonne réponse ou même `correct` pour un vrai/faux, langue différente de l'original. Il passe à vide pour l'instant.
- [ ] **Step 6:** `pnpm typecheck` et `pnpm lint` : PASS.
- [ ] **Step 7: Commit** `feat(library): outil de traduction des packs du catalogue`

### Task 6: Open Trivia DB traduit en français

**Files:**
- Create: `packages/library/translations/opentdb-fr/*.json` (un fichier par lot)
- Create (généré) : `packages/library/catalog/opentdb-fr/**`

- [ ] **Step 1:** découper les questions d'Open Trivia DB en lots (environ 120 par lot, un sous-agent par lot). Le sous-agent écrit la table de son lot : `skip` avec motif pour les questions non traduisibles (fiche de Task 4), sinon traduction française naturelle (pas de calque), réponses de 25 caractères au plus (abréger, remplacer une unité impériale par son équivalent si la question n'en dépend pas, sinon `skip`), noms d'œuvres sous leur titre français s'il existe, typographie des Global Constraints.
- [ ] **Step 2:** traduire les titres et descriptions des quiz dont toutes les questions sont traduites (clé `quizzes`).
- [ ] **Step 3: seconde passe.** Un autre sous-agent relit chaque table contre l'original : sens, bonne réponse toujours juste, distracteurs plausibles en français, longueur, typographie. Il corrige directement la table et liste ses corrections.
- [ ] **Step 4: Run** `pnpm dlx tsx packages/library/scripts/translate-catalog.ts --from opentdb --to fr` : fin sans erreur. `pnpm vitest run packages/library` : PASS (doublons, cohérence). Un doublon détecté se règle en `skip` avec motif `doublon de <id>`.
- [ ] **Step 5: Commit** `feat(library): Open Trivia DB traduit en français`

### Task 7: OpenQuizzDB traduit en anglais

**Files:**
- Create: `packages/library/translations/openquizzdb-en/*.json`
- Create (généré) : `packages/library/catalog/openquizzdb-en/**`

- [ ] **Step 1:** mêmes étapes que la Task 6 pour toutes les questions OpenQuizzDB (exclues comprises : elles ne sont plus dans les packs, donc pas dans la table). Motifs de `skip` propres à ce sens : culture française sans écho à l'étranger (animateurs, émissions, chanteurs peu connus hors de France), jeux sur la langue française. Les titres d'œuvres prennent leur titre anglais d'origine.
- [ ] **Step 2:** seconde passe comme en Task 6.
- [ ] **Step 3: Run** `pnpm dlx tsx packages/library/scripts/translate-catalog.ts --from openquizzdb --to en` puis `pnpm vitest run packages/library` : PASS ; une traduction identique à une question d'Open Trivia DB devient `skip` `doublon de <id>`.
- [ ] **Step 4: Commit** `feat(library): OpenQuizzDB traduit en anglais`

### Task 8: Garde-fous du catalogue et vérification finale

**Files:**
- Modify: `packages/library/src/catalog.test.ts`
- Modify: `docs/` si une page décrit le contenu du catalogue (chercher « OpenQuizzDB » dans `docs/` et `README.md`)

- [ ] **Step 1:** ajouter à `catalog.test.ts` :
  - `les propositions tiennent dans une tuile` : toute proposition d'une question en français, ou d'un pack dont l'`originFile` commence par `builtin:openquizzdb-en/` ou `builtin:opentdb-fr/`, fait 25 caractères au plus.
  - `chaque quiz est dans la langue de ses questions`.
  - `au moins deux quiz en français par thème` (thèmes non masqués).
  - `pas de tiret cadratin ni demi-cadratin dans les textes traduits` : énoncés, propositions, titres et descriptions des packs traduits sans `—` ni `–`.
  - relever le seuil `contient au moins 300 questions et 10 quiz` à la réalité arrondie à la centaine inférieure.
- [ ] **Step 2:** `pnpm vitest run packages/library` : PASS ; si un test échoue sur le contenu, corriger le contenu (table ou plans), pas le test.
- [ ] **Step 3:** `pnpm lint`, `pnpm typecheck`, `pnpm test` : PASS.
- [ ] **Step 4:** mettre à jour la documentation trouvée à l'étape de recherche (chiffres du catalogue, sources, traductions).
- [ ] **Step 5: Commit** `test(library): garde-fous du catalogue enrichi`
