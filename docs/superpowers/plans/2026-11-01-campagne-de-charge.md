# Campagne de charge manuelle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une commande lancée à la main (`pnpm --filter @splootlabs/server charge:campagne -- --scenario rapide`) qui rejoue le protocole de charge de bout en bout, garde un historique compact versionné et signale les régressions par rapport aux campagnes précédentes.

**Architecture:** Un orchestrateur `campagne.mjs` pilote la pile `pengou-charge` (remise à zéro, attente de `/health`, pause), lance `charge.mjs` en processus enfant pour chaque passage d'un scénario, vérifie la cohérence de la base par `psql`, puis ajoute une ligne par passage à `docs/charge/historique.jsonl` et compare à la dernière campagne comparable. Les JSON complets vont dans `charge-resultats/` (ignoré par git). Les fonctions pures (ligne d'historique, comparaison, résumé du lag) sont testées par Vitest comme `stats.mjs`.

**Tech Stack:** Node 24 (ESM `.mjs`, `node:child_process`, `node:util` `parseArgs`), Docker Compose, Vitest.

**Spec:** analyse du 1er novembre 2026 (conversation) et `docs/charge/2026-10-31-resultats.md` pour le protocole.

## Global Constraints

- Lancement manuel uniquement : aucune planification, aucun job CI qui lance la charge.
- Cible toujours `http://localhost:3000` (garde `estCibleLocale` inchangée), projet Compose `pengou-charge`, fichier `docker-compose.charge.yml`.
- Protocole par passage : `down -v`, `up -d` (le `--build` une seule fois en début de campagne), attente de `/health` (200) au plus 120 s, puis pause de 30 s (option `--pause` en secondes), 10 questions, `--docker pengou-charge`.
- Un seul générateur à la fois : la campagne joue ses passages en série.
- Historique : `docs/charge/historique.jsonl`, une ligne JSON par passage, ajout seulement (jamais de réécriture).
- Sorties brutes : `charge-resultats/<campagne>/` où `<campagne>` = `AAAA-MM-JJTHH-MM-SS-<commit court>`, ajouté au `.gitignore`.
- Code et messages en français, dans le style des fichiers de `apps/server/charge/` ; ne jamais lancer `biome format --write`.
- Typographie des textes produits (résumé, README) : pas de tiret cadratin ni demi-cadratin, pas de gras d'emphase, casse de phrase dans les titres.

## Review Focus

- `.env` absent ou incomplet : `docker compose up` échoue ; la campagne doit s'arrêter tout de suite avec le message de Compose, sans écrire d'historique (test manuel, Task 3 étape 5).
- Passage interrompu (`host:start` sans accusé, enfant qui meurt) : un JSON partiel `verdict: 'interrompu'` est écrit et la ligne d'historique existe ; la campagne continue au passage suivant (test `ligneHistorique accepte un résumé interrompu`, Task 2).
- Historique vide ou sans campagne comparable : la comparaison n'affiche « aucune référence » et ne signale aucune régression (test `comparer sans référence`, Task 2).
- Machine différente de la référence : la comparaison ne compare qu'à une ligne de même `machine.cpu` ; sinon « aucune référence » (test `comparer ignore une autre machine`, Task 2).
- Ligne d'historique illisible (fusion git, ligne tronquée) : `lireHistorique` l'ignore au lieu de planter (test `lireHistorique ignore une ligne invalide`, Task 2).

---

### Task 1: Mesures plus stables et JSON partiel dans le générateur

**Files:**
- Modify: `apps/server/charge/stats.mjs` (ajout de `resumerLag`)
- Modify: `apps/server/charge/metriques.mjs` (`echantillonnerServeur.arreter` renvoie aussi `lagP95Ms` et `secondesLagAuDessus`)
- Modify: `apps/server/charge/charge.mjs` (diffusion de la première question, JSON partiel en cas d'échec)
- Test: `apps/server/charge/stats.test.mjs`

**Interfaces:**
- Produces: `resumerLag(echantillonsMs: number[], seuilMs: number) => { p95: number, auDessus: number }` (p95 par `percentile`, arrondi au dixième, `NaN` si vide ; `auDessus` = nombre d'échantillons strictement au-dessus du seuil).
- Produces: dans le résumé JSON, `serveur.lagP95Ms`, `serveur.secondesLagAuDessus` (seuil `LAG_SERVEUR_P99_MAX_MS`), `latences.diffusionPremiereMs` (diffusion de l'index 0, maximum sur les parties, `null` si absente).
- Produces: en cas d'exception dans `main`, si `--json` est fourni, un fichier `{ libelle, horodatage, parametres, verdict: 'interrompu', erreur: <message> }` puis sortie code 1. Le verdict `interrompu` est nouveau, `verdict()` n'est pas modifié.

- [ ] **Step 1: Écrire les tests qui échouent** dans `stats.test.mjs` :

```js
describe('resumerLag', () => {
  it('donne le p95 et le nombre de secondes au-dessus du seuil', () => {
    const r = resumerLag([10, 20, 30, 250, 40, 50, 60, 70, 80, 300], 200)
    expect(r).toEqual({ p95: 300, auDessus: 2 })
  })
  it('renvoie NaN et 0 sans échantillon', () => {
    const r = resumerLag([], 200)
    expect(Number.isNaN(r.p95)).toBe(true)
    expect(r.auDessus).toBe(0)
  })
})
```

- [ ] **Step 2: Vérifier l'échec** : `pnpm vitest run apps/server/charge/stats.test.mjs`, attendu FAIL (`resumerLag` non exporté).
- [ ] **Step 3: Implémenter `resumerLag`** dans `stats.mjs`, l'utiliser dans `metriques.mjs` sur la série `lag` existante, ajouter `diffusionPremiereMs` dans `charge.mjs` (à partir de `derniereReception` filtrée sur `index === 0`) et le JSON partiel dans le `catch` de `main`. Afficher les deux nouvelles valeurs dans le `console.table` serveur existant.
- [ ] **Step 4: Vérifier** : `pnpm vitest run apps/server/charge/`, attendu PASS.
- [ ] **Step 5: Commit** : `git commit -m "test(charge): lag p95, secondes au-dessus du seuil, première diffusion et résumé partiel"`

### Task 2: Historique compact et comparaison

**Files:**
- Create: `apps/server/charge/historique.mjs`
- Test: `apps/server/charge/historique.test.mjs`

**Interfaces:**
- Consumes: le résumé JSON de `charge.mjs` (Task 1), y compris la forme partielle `interrompu`.
- Produces: `ligneHistorique(resume, contexte, essai: number, coherence: boolean | null) => Ligne` où `contexte = { campagne, scenario, commit, modifie, machine: { cpu, coeurs, memGo, dockerCpus, dockerMemGo } }` et

```js
// Ligne : champs absents d'un résumé interrompu mis à null.
{ campagne, scenario, commit, modifie, machine, libelle, essai,
  cle,            // `${parties}x${joueurs}@${cadence}`
  joueurs, parties, cadence, questions, verdict, criteresEchoues, // noms des critères à false
  joinP95, reponseP95, diffusionP95, diffusionPremiereMs,
  lagP99MaxMs, lagP95Ms, secondesLagAuDessus,
  cpuAppMaxPct, cpuDbMaxPct, rssMaxMo, coherence }
```

  `cpuAppMaxPct` et `cpuDbMaxPct` viennent de `resume.docker`, conteneurs dont le nom finit par `-app-1` et `-db-1`.
- Produces: `lireHistorique(chemin) => Ligne[]` (fichier absent : `[]`, ligne illisible ignorée) et `ajouterHistorique(chemin, lignes: Ligne[])` (`appendFileSync`, une ligne par entrée).
- Produces: `comparer(nouvelles: Ligne[], historique: Ligne[]) => Array<{ cle, reference: string | null, regressions: string[] }>`. Référence d'une clé : la campagne la plus récente de l'historique, autre que celle des nouvelles lignes, de même `cle` et même `machine.cpu`. Régressions : verdict `reussi` dans la référence et autre chose maintenant (`verdict reussi -> echoue`), ou pour chacune de `reponseP95`, `diffusionP95`, `lagP95Ms`, `joinP95` : moyenne des essais actuels supérieure à 1,5 fois la moyenne de référence et d'au moins 20 ms de plus (`lagP95Ms 40 -> 95`).

- [ ] **Step 1: Écrire les tests qui échouent** dans `historique.test.mjs` (fixtures construites à la main, pas de fichiers de `docs/charge/brut`) :
  - `ligneHistorique extrait les chiffres clés` : résumé réussi de 800 joueurs, attendu `cle: '1x800@25'`, `criteresEchoues: []`, `cpuAppMaxPct` lu sur `pengou-charge-app-1`.
  - `ligneHistorique accepte un résumé interrompu` : attendu `verdict: 'interrompu'`, `reponseP95: null`, pas d'exception.
  - `comparer sans référence` : historique vide, attendu `[{ cle: '1x800@25', reference: null, regressions: [] }]`.
  - `comparer signale une régression de lag` : référence `lagP95Ms: 40`, nouveau `95`, attendu `regressions` contient `'lagP95Ms 40 -> 95'`.
  - `comparer ignore une petite hausse` : `reponseP95` 4 puis 9 (plus que 1,5 fois mais moins de 20 ms), attendu aucune régression.
  - `comparer signale un verdict perdu` : attendu `'verdict reussi -> echoue'`.
  - `comparer ignore une autre machine` : référence d'un autre `machine.cpu`, attendu `reference: null`.
  - `lireHistorique ignore une ligne invalide` : fichier temporaire (`os.tmpdir()`) avec une ligne valide, une ligne `{tronq`, attendu une seule ligne lue.
- [ ] **Step 2: Vérifier l'échec** : `pnpm vitest run apps/server/charge/historique.test.mjs`, attendu FAIL (module absent).
- [ ] **Step 3: Implémenter `historique.mjs`** avec les signatures ci-dessus.
- [ ] **Step 4: Vérifier** : même commande, attendu PASS.
- [ ] **Step 5: Commit** : `git commit -m "test(charge): historique compact des passages et comparaison aux campagnes précédentes"`

### Task 3: Orchestrateur de campagne

**Files:**
- Create: `apps/server/charge/scenarios.mjs`
- Create: `apps/server/charge/campagne.mjs`
- Modify: `apps/server/package.json` (script `"charge:campagne": "node charge/campagne.mjs"`)
- Modify: `.gitignore` (ligne `charge-resultats/` sous le commentaire du générateur)

**Interfaces:**
- Consumes: `ligneHistorique`, `lireHistorique`, `ajouterHistorique`, `comparer` (Task 2) ; options CLI de `charge.mjs` existantes.
- Produces: `SCENARIOS: Record<string, Array<{ libelle, joueurs, parties, cadence, essais }>>` avec exactement :
  - `rapide` : `p640` (1×640, cadence 25, 1 essai), `p800` (1×800, 25, 1), `etab` (10×30, 25, 1). Environ 10 minutes.
  - `complet` : `p300`, `p500`, `p750`, `p800`, `p900`, `p1000` (une partie, cadence 25, 2 essais), `etab` (10×30, 2 essais), `rafale` (1×800, cadence 250, 1 essai).
- Produces: CLI `campagne.mjs [--scenario rapide|complet] [--pause S] [--sans-build]`, défaut `rapide` et 30 s. Code de sortie 0 si aucune régression ni passage non `reussi`, 1 sinon, 2 si la pile ne démarre pas.

Déroulé de `campagne.mjs` (fonctions locales, non exportées) :
1. Contexte : commit par `git rev-parse --short HEAD`, `modifie` = sortie non vide de `git status --porcelain`, machine par `os.cpus()` et `os.totalmem()`, Docker par `docker info --format "{{.NCPU}} {{.MemTotal}}"`. Crée `charge-resultats/<campagne>/` à la racine du dépôt.
2. `docker compose -p pengou-charge -f docker-compose.charge.yml build` sauf `--sans-build` ; échec : afficher stderr, sortie 2.
3. Pour chaque passage et chaque essai : `down -v`, `up -d`, attente de `/health` (sondage chaque seconde, 120 s au plus, sinon sortie 2), pause, puis `fork('charge.mjs', [...options, '--json', <dossier>/<libelle>-<essai>.json, '--docker', 'pengou-charge', '--questions', '10', '--libelle', '<libelle>-<essai>'])` et attente de sa sortie. Si le JSON n'existe pas après la sortie, construire le résumé interrompu en mémoire.
4. Cohérence (sauf passage interrompu) : pour chaque partie du JSON, `docker compose ... exec -T db psql -U pengou -d pengou -tAc "select (select count(*) from session_player where session_id='<id>'), (select count(*) from answer_record where session_id='<id>')"`, comparé à `rejoints` et `reponsesAcceptees` ; relire toutes les 5 s pendant 60 s au plus tant que ça ne concorde pas. `true` si tout concorde, `false` sinon.
5. Après le dernier passage : `down -v`, `comparer` contre `lireHistorique` (lu avant l'ajout), puis `ajouterHistorique`, puis écrire `<dossier>/resume.md` (en-tête : commit, machine, scénario ; une phrase par passage : verdict, réponse p95, diffusion p95, lag p95 et max, cohérence ; puis les régressions ou « Aucune régression par rapport à <référence> ») et l'afficher en console.

- [ ] **Step 1: Écrire `scenarios.mjs` et `campagne.mjs`**, ajouter le script et la ligne `.gitignore`.
- [ ] **Step 2: Essai à blanc** : `pnpm --filter @splootlabs/server charge:campagne -- --scenario rapide`. Attendu : trois JSON et `resume.md` dans `charge-resultats/<campagne>/`, trois lignes ajoutées à `docs/charge/historique.jsonl`, chaque passage `reussi` avec `coherence: true`, « aucune référence » pour chaque clé.
- [ ] **Step 3: Second lancement** de la même commande. Attendu : la comparaison cite la campagne précédente comme référence, aucune régression, code de sortie 0.
- [ ] **Step 4: Supprimer les lignes de ces deux essais** de `docs/charge/historique.jsonl` (elles servaient au réglage) ; garder le fichier vide pour la Task 4.
- [ ] **Step 5: Vérifier l'arrêt propre** : renommer temporairement `.env`, relancer. Attendu : message de Compose, code 2, `historique.jsonl` inchangé. Remettre `.env`.
- [ ] **Step 6: Commit** : `git commit -m "feat(charge): campagne de charge lancée à la main avec historique et comparaison"`

### Task 4: Référence initiale et mode d'emploi

**Files:**
- Modify: `docs/charge/historique.jsonl` (lignes importées)
- Create: `docs/charge/README.md`

**Interfaces:**
- Consumes: `ligneHistorique`, `ajouterHistorique` (Task 2).

- [ ] **Step 1: Importer la campagne `-lb` du 31 octobre** avec un script jetable dans le scratchpad (pas versionné) : pour chaque `docs/charge/brut/*-lb-*.json` et `etab-lb-*.json`, `ligneHistorique(resume, { campagne: '2026-10-31-9011613', scenario: 'import', commit: '9011613', modifie: false, machine: { cpu: 'AMD Ryzen 9 4900HS with Radeon Graphics', coeurs: 16, memGo: 31.4, dockerCpus: 16, dockerMemGo: 15.3 } }, essai, null)`. Vérifier avant l'import que `cpu` est bien la chaîne renvoyée par `os.cpus()[0].model` sur ce poste, sinon la comparaison ne trouvera jamais cette référence.
- [ ] **Step 2: Vérifier** : `node -e` qui lit le fichier par `lireHistorique` ; attendu 14 lignes (12 paliers plus 2 établissement), dont `1x800@25` deux fois `reussi`.
- [ ] **Step 3: Écrire `docs/charge/README.md`** en prose courte : prérequis (`.env` avec `PENGOU_CHARGE_*`, `SESSION_SECRET`, `BETTER_AUTH_SECRET`, Docker démarré, poste sans autre charge), commande, durée des deux scénarios, où lire les résultats, comment lire une régression, et qu'il faut committer `historique.jsonl` après une campagne qu'on veut garder.
- [ ] **Step 4: Vérification finale** : `pnpm vitest run apps/server/charge/`, attendu PASS ; `git status` ne montre rien sous `charge-resultats/`.
- [ ] **Step 5: Commit** : `git commit -m "docs(charge): référence initiale de l'historique et mode d'emploi des campagnes"`
