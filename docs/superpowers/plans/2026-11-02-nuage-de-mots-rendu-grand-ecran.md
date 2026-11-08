# Nuage de mots, rendu grand écran : plan d'implémentation

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Objectif : remplacer, sur le grand écran uniquement, le nuage en lignes par un nuage typographique en spirale (couleurs, deux orientations, tailles continues, animations) avec un moment de fin qui allume le top 4.

Architecture : une fonction pure de placement (`layoutCloud`) calcule positions, tailles, orientations et couleurs dans un espace virtuel de 1600 × 800, en réutilisant les positions précédentes. Un nouveau composant `BigWordCloud` mesure les mots dans le DOM, appelle `layoutCloud` à chaque mise à jour, met la scène à l'échelle de son cadre et gère la phase de fin (top 4, pastilles, fondu des mots retirés). `BigScreen` l'utilise à la place de `WordCloud` ; `HostLive` garde `WordCloud`, inchangé.

Pile : React 19, TypeScript, CSS (transitions et keyframes sur les tokens de `tokens.motion.css`), Vitest + Testing Library (jsdom).

Spec : `docs/superpowers/specs/2026-11-02-nuage-de-mots-rendu-grand-ecran-design.md`. Maquette de référence (non versionnée) : `.superpowers/brainstorm/114585-1793607188/content/nuage-a-fin.html`, dont les constantes ci-dessous sont reprises.

## Contraintes globales

- Travailler sur la branche `feat/nuage-rendu-grand-ecran` (créée depuis `main` à la tâche 1).
- Aucun changement serveur, protocole ou `packages/` ; `HostLive.tsx` et `ui/WordCloud.tsx` ne changent pas.
- `framer-motion`, `.getContext(` et Web Audio interdits hors de `apps/web/src/motion/` (garde `architecture.test.ts`). Importer `useReducedMotion` depuis `../motion/index.js` est permis.
- Ne pas lancer `biome format --write`. `pnpm lint`, `pnpm typecheck` et `pnpm test` doivent passer.
- Animations décoratives : jamais seules porteuses d'information ; en reduced-motion, mêmes états finaux, sans mouvement.
- Textes d'interface en français, apostrophe droite, guillemets « », pas de tiret cadratin.

## Points de vigilance (review focus)

1. Un mot de 25 caractères en tête (« anticonstitutionnellement ») doit tenir dans la largeur : test dans la tâche 1.
2. Cent mots à une occurrence chacun (distribution plate, cas d'une grande salle) : aucun chevauchement et calcul en moins de 50 ms : test dans la tâche 1.
3. Mise à jour toutes les 500 ms où seuls les compteurs changent : aucun mot ne bouge s'il tient encore à sa place : test dans la tâche 1.
4. Retrait du mot de tête pendant la révélation : le cinquième s'allume, les autres ne bougent pas : test dans la tâche 3.
5. Reconnexion du grand écran pendant la révélation : état final affiché d'un coup, sans arrivée échelonnée : test dans la tâche 3.

---

### Tâche 1 : placement pur du nuage

Fichiers :
- Create : `apps/web/src/ui/wordcloud/layout.ts`
- Test : `apps/web/src/ui/wordcloud/layout.test.ts`

Interfaces (produites) :

```ts
export const STAGE_W = 1600
export const STAGE_H = 800
export const PALETTE_SIZE = 7
export interface CloudWordInput { key: string; text: string; count: number }
/** Dimensions d'un mot mesuré à 100 px de police, sans rotation. */
export type Measure = (text: string) => { w: number; h: number }
export interface PlacedWord extends CloudWordInput {
  x: number; y: number          // centre, en px de scène
  boxW: number; boxH: number    // boîte englobante après rotation
  fontSize: number
  vertical: boolean
  colorIndex: number            // 0..PALETTE_SIZE-1
  rank: number                  // 1 = plus cité
  small: boolean                // traîne atténuée
}
export interface LayoutOptions {
  measure: Measure
  previous?: ReadonlyMap<string, { x: number; y: number }>
  firstKey?: string             // premier mot affiché de la question : forcé horizontal
}
export function hashKey(key: string): number
export function sortWords<T extends CloudWordInput>(words: readonly T[]): T[]
export function layoutCloud(words: readonly CloudWordInput[], opts: LayoutOptions): { placed: PlacedWord[]; hidden: string[] }
```

- [ ] Étape 1 : créer la branche et commiter la spec.

```bash
git switch -c feat/nuage-rendu-grand-ecran
git add docs/superpowers/specs/2026-11-02-nuage-de-mots-rendu-grand-ecran-design.md docs/superpowers/plans/2026-11-02-nuage-de-mots-rendu-grand-ecran.md
git commit -m "docs(nuage): conception et plan du rendu grand écran"
```

- [ ] Étape 2 : écrire les tests qui échouent. Mesure factice : `const measure: Measure = (t) => ({ w: t.length * 55, h: 100 })`. Utilitaire de test `overlaps(a, b)` : vrai si `|a.x-b.x| < (a.boxW+b.boxW)/2 && |a.y-b.y| < (a.boxH+b.boxH)/2`.

```ts
it('trie par occurrences décroissantes puis ordre alphabétique fr', () => {
  expect(sortWords([{key:'b',text:'bé',count:2},{key:'a',text:'âne',count:2},{key:'c',text:'c',count:5}]).map(w=>w.key)).toEqual(['c','a','b'])
})
it('place le premier mot au centre, horizontal, avec le rang 1', () => {
  const { placed } = layoutCloud([{ key: 'equipe', text: 'équipe', count: 5 }], { measure, firstKey: 'equipe' })
  expect(placed[0]).toMatchObject({ x: 800, y: 400, vertical: false, rank: 1 })
})
it('ne superpose aucun mot', () => { /* 40 mots aux compteurs variés : aucune paire placée ne se chevauche, toutes les boîtes restent dans [0,1600]x[0,800] */ })
it('dérive couleur et orientation de la clé, de façon stable', () => {
  /* même clé dans deux appels avec des compteurs différents : même colorIndex et même vertical ;
     colorIndex === hashKey(key) % 7 ; vertical === (hashKey(key) % 10 < 3) sauf pour firstKey */
})
it('ne force pas à l\'horizontale un mot vertical qui prend la tête', () => {
  /* choisir une clé k avec hashKey(k) % 10 < 3, k !== firstKey, count maximal : vertical === true */
})
it('fait croître la taille avec la racine du rapport au premier', () => {
  /* compteurs 16 et 4 : fontSize 156 et 34 + 122 * 0.5 = 95 (à 0,01 près), avant réduction de largeur */
})
it('marque la traîne atténuée sous un quart du premier quand il dépasse 3', () => {
  /* compteurs 8 et 1 : small true pour le second ; compteurs 3 et 1 : small false */
})
it('réduit un mot trop long pour tenir en largeur', () => {
  const { placed } = layoutCloud([{ key: 'x', text: 'anticonstitutionnellement', count: 9 }], { measure, firstKey: 'x' })
  expect(placed[0].boxW).toBeLessThanOrEqual(1250)
})
it('garde la position précédente quand elle est encore libre', () => {
  /* layout A de 30 mots, puis mêmes mots avec un compteur de traîne +1 et previous = positions de A :
     chaque mot dont la boîte ne chevauche rien garde exactement x,y */
})
it('place toujours le top 4, quitte à le réduire', () => { /* 100 mots longs : les 4 premiers sont dans placed, jamais dans hidden */ })
it('tient cent mots à une occurrence en moins de 50 ms sans chevauchement', () => { /* performance.now() autour de layoutCloud */ })
```

- [ ] Étape 3 : lancer `pnpm vitest run apps/web/src/ui/wordcloud/layout.test.ts`. Attendu : échec, module introuvable.

- [ ] Étape 4 : implémenter `layout.ts`. `hashKey` : `h = 7; h = (h * 31 + code) | 0` sur chaque caractère, puis `Math.abs`. `sortWords` : `b.count - a.count || a.text.localeCompare(b.text, 'fr')`. Algorithme de `layoutCloud`, à reprendre tel quel de la maquette :

```text
max = count du premier (après sortWords) ; placed = []
pour chaque mot, rang i (0-based) :
  ratio = count / max ; size = 34 + 122 * sqrt(ratio)
  m = measure(text) ; w = m.w*size/100 ; h = m.h*size/100
  si w > 1250 : f = 1250/w ; size, w, h *= f
  vertical = key !== firstKey && hash % 10 < 3
  boxW, boxH = vertical ? (h, w) : (w, h) ; pad = 7
  fits(x,y) = boîte dans [24, 1600-24] x [24, 800-24] et aucune collision avec placed (marge pad)
  si previous[key] existe et fits : garder
  sinon spirale : t = 0 ; jusqu'à 4000 pas : r = 6t ; x = 800 + 1.75 r cos(t + phase) ; y = 400 + r sin(t + phase)
                  (phase = (hash % 628) / 100) ; arrêt si r > 1000 ; t += min(0.5, 9/(r+1))
  si non placé et i < 4 : réessayer avec size *= 0.85, au plus 5 fois
  si toujours non placé : hidden.push(key)
```

Le premier mot sans `previous` doit tomber exactement sur (800, 400) : au premier pas, r = 0.

- [ ] Étape 5 : relancer le test. Attendu : tous verts.

- [ ] Étape 6 : commit `feat(nuage): placement en spirale du nuage grand écran`.

---

### Tâche 2 : composant `BigWordCloud` en direct

Fichiers :
- Create : `apps/web/src/ui/wordcloud/BigWordCloud.tsx`, `apps/web/src/ui/wordcloud/useWordMeasure.ts`
- Modify : `apps/web/src/prototype.css` (nouveau bloc `.bigcloud`, après le bloc `.wordcloud` vers la ligne 3480)
- Test : `apps/web/src/ui/wordcloud/BigWordCloud.test.tsx`

Interfaces :
- Consomme : tout ce qu'exporte `layout.ts` (tâche 1).
- Produit :

```ts
export interface BigWordCloudProps {
  words: CloudWordInput[]
  revealed: boolean        // utilisé à la tâche 3 ; ignoré ici
  reducedMotion: boolean
  emptyLabel?: string      // défaut : 'En attente des premières idées…'
}
export function BigWordCloud(props: BigWordCloudProps): JSX.Element
export function useWordMeasure(): { measure: Measure; version: number } // version s'incrémente quand les polices sont prêtes
```

- [ ] Étape 1 : écrire les tests qui échouent (jsdom, `render` direct, sans `MotionProvider`).

```ts
it('affiche le libellé vide sans mot', ...)                       // 'En attente des premières idées…'
it('affiche chaque mot une seule fois en texte visible', ...)       // getByText('café') unique
it('expose une liste accessible « Nuage de mots »', ...)            // getByRole('list', { name: 'Nuage de mots' }) a le texte 'café, 3'
it('cache les mots dessinés aux lecteurs d\'écran', ...)            // le conteneur des mots dessinés a aria-hidden="true"
it('applique la classe de couleur dérivée de la clé', ...)          // élément de 'café' a la classe `bigcloud__word--c${hashKey('cafe') % 7}`
it('marque le mot de tête', ...)                                    // data-top="true" sur le mot de rang 1 seulement
it('passe en mode immobile en reduced-motion', ...)                 // racine a la classe 'bigcloud--still'
it('fige le premier mot reçu comme firstKey même s\'il est dépassé', ...)
  // rerender avec un autre mot en tête : le premier mot garde vertical=false (data-vertical="false")
```

- [ ] Étape 2 : lancer `pnpm vitest run apps/web/src/ui/wordcloud/BigWordCloud.test.tsx`. Attendu : échec.

- [ ] Étape 3 : implémenter `useWordMeasure` : un `<span>` caché (classe `bigcloud__measure`, `font-size: 100px`, sans transition ni animation) ajouté à `document.body`, cache par texte, repli `{ w: text.length * 55, h: 100 }` quand `offsetWidth` vaut 0 (jsdom) ; `document.fonts?.ready` vide le cache et incrémente `version`.

- [ ] Étape 4 : implémenter `BigWordCloud`. Structure DOM :

```text
div.bigcloud[.bigcloud--still][.bigcloud--revealed]       // cadre, aspect-ratio 2 / 1, largeur 100 %
  div.bigcloud__stage (1600x800, transform: scale(k), aria-hidden="true")
    div.bigcloud__word (translate(x,y))  > div.bigcloud__rot (translate(-50%,-50%) rotate(0|-90deg)) > span.bigcloud__text
  ul.visually-hidden aria-label="Nuage de mots" > li `${text}, ${count}`
```

`firstKey` et les positions précédentes vivent dans des `useRef` ; le composant est remonté par question (clé posée par `BigScreen`). Mise à l'échelle par `ResizeObserver` sur le cadre (`k = largeur / 1600`), gardée par `typeof ResizeObserver !== 'undefined'`. Attributs sur `.bigcloud__word` : `data-key`, `data-top`, `data-small`, `data-vertical`. Éclosion : classe `is-new` posée au premier rendu d'une clé ; pulsation : classe `is-bump` reposée (retrait, reflow, ajout) quand `count` augmente.

- [ ] Étape 5 : CSS `.bigcloud`. Palette des classes `--c0` à `--c6`, dans cet ordre (`--wc-text` / `--wc-fill` / `--wc-ink`) : `#35cbec/#00a6cc/#06162b`, `#a89bff/#7c6bf0/#ffffff`, `#ff8a52/#ff7a3c/#0b2545`, `#ffd15e/#ffd15e/#0b2545`, `#4fd6a6/#4fd6a6/#0b2545`, `#ff9ec4/#ff9ec4/#0b2545`, `#bdebf7/#bdebf7/#0b2545`. Police `var(--font-display)`, graisse 600, `line-height: 1`. Mot de tête : `text-shadow: 0 0 42px var(--wc-text)`. Traîne : `opacity: .62`. Transitions : position et rotation 800 ms `var(--ease-out)`, `font-size` 700 ms `var(--ease-out)`. Éclosion 650 ms `var(--ease-spring)` (scale 0 → 1.18 → 1). Pulsation 450 ms `var(--ease-spring)` (scale 1 → 1.14 avec `brightness(1.35)` → 1). Fond de scène : étoiles en `::before` scintillant sur 5 s (opacité .18 ↔ .38), comme la maquette. `.bigcloud--still` coupe toutes les transitions et animations (y compris `::before`).

- [ ] Étape 6 : relancer les tests de la tâche. Attendu : verts.

- [ ] Étape 7 : commit `feat(nuage): composant BigWordCloud animé`.

---

### Tâche 3 : moment de fin dans `BigWordCloud`

Fichiers :
- Modify : `apps/web/src/ui/wordcloud/BigWordCloud.tsx`, `apps/web/src/prototype.css`
- Test : `apps/web/src/ui/wordcloud/BigWordCloud.test.tsx`

Interfaces : consomme `BigWordCloudProps.revealed` (tâche 2) ; ne produit rien de nouveau.

- [ ] Étape 1 : écrire les tests qui échouent (`vi.useFakeTimers()`). Cinq mots `a`..`e` aux compteurs 9, 7, 5, 3, 1.

```ts
it('allume le top 4 et éteint le reste à la révélation', ...)
  // après rerender revealed=true : racine a 'bigcloud--revealed' ; data-lit="true" sur a,b,c,d, absent sur e
it('fait arriver les pastilles de la 4e à la 1re', ...)
  // live rendu depuis 2 s, puis revealed : à t+900 ms seule la pastille de rang 4 ; à t+900+3*550 ms les 4,
  // chacune avec le texte du rang et `${count} fois` (ex. '9 fois')
it('annonce le top 4 aux lecteurs d\'écran', ...)
  // getByRole('list', { name: 'Mots les plus proposés' }) contient '1. a, 9 fois' ... '4. d, 3 fois' ; pastilles aria-hidden
it('affiche tout d\'un coup en reduced-motion', ...)            // reducedMotion=true : 4 pastilles dès le rendu révélé
it('affiche tout d\'un coup après une reconnexion en révélation', ...)
  // révélation moins de 1000 ms après le premier rendu en direct avec des mots : 4 pastilles immédiatement
it('remplace un mot du top 4 retiré par le suivant, sans déplacer les autres', ...)
  // révélé, puis rerender sans 'a' : e devient data-lit, pastilles rangs 1..4 = b,c,d,e ;
  // transform de b,c,d inchangé ; 'a' porte la classe 'is-leaving' puis disparaît après 400 ms
```

- [ ] Étape 2 : lancer les tests. Attendu : les nouveaux échouent.

- [ ] Étape 3 : implémenter. En révélation, le composant n'appelle plus `layoutCloud` : il garde la dernière disposition calculée en direct (positions et tailles), en retire simplement les mots absents du nouveau `words` et met à jour les compteurs. Sans ce gel, retirer le premier mot changerait le maximum, donc toutes les tailles, et ferait bouger le nuage. Top 4 = les quatre premiers de `sortWords` parmi les mots de cette disposition figée. `data-lit="true"` sur ces mots. Arrivée échelonnée : premier délai 900 ms, puis 550 ms entre chaque pastille, de la 4e à la 1re ; pas d'échelonnement si `reducedMotion` ou si la révélation arrive moins de 1000 ms après le premier rendu en direct avec au moins un mot (cas de reconnexion, où `question:show`, `wordcloud:update` et `question:reveal` se succèdent). Une fois toutes les pastilles affichées, un changement du top 4 (retrait) met à jour les pastilles sans rejouer l'échelonnement. Mot retiré : conservé 400 ms avec la classe `is-leaving` (fondu d'opacité), 0 ms en reduced-motion. Pastille : `div.bigcloud__badge`, positionnée en coordonnées de scène au coin haut droit de la boîte du mot (`x + boxW/2`, `y - boxH/2`), contenu `span.bigcloud__rank` (rang) puis `${count} fois`.

- [ ] Étape 4 : CSS. `.bigcloud--revealed .bigcloud__word` : `opacity: .16; filter: saturate(.3)`, transition 600 ms ; `[data-lit="true"]` : opacité 1, sans filtre, halo du mot de tête, `scale(1.1)` sur `.bigcloud__rot`. Pastille : fond `#ffffff`, encre `#0b2545`, `var(--font-body)` graisse 800, 26 px de scène, rayon 999px, `box-shadow: 0 6px 0 rgba(0,0,0,.25)`, `transform: translate(-30%,-70%)`, entrée 550 ms `var(--ease-spring)` (scale .3 → 1). Rang : rond de 44 px, fond `var(--wc-fill)`, encre `var(--wc-ink)`, Fredoka 700. Ajuster le décalage pour qu'une pastille ne recouvre pas le mot qu'elle désigne (défaut constaté sur la maquette).

- [ ] Étape 5 : relancer les tests de la tâche. Attendu : verts.

- [ ] Étape 6 : commit `feat(nuage): moment de fin avec le top 4`.

---

### Tâche 4 : branchement dans `BigScreen` et vérification visuelle

Fichiers :
- Modify : `apps/web/src/screens/BigScreen.tsx:464-473` (`renderWordcloud`) et ses imports
- Modify : `apps/web/src/prototype.css` (`.big-wordcloud` : laisser au nuage la place disponible, sans défilement)
- Test : `apps/web/src/screens/BigScreen.wordcloud.test.tsx`

Interfaces : consomme `BigWordCloud` (tâches 2 et 3) et `useReducedMotion` de `../motion/index.js`.

- [ ] Étape 1 : ajouter les tests qui échouent dans `BigScreen.wordcloud.test.tsx` (les tests existants doivent continuer à passer sans modification) :

```ts
it('affiche le top 4 à la révélation', ...)
  // view() avec 5 mots ; question:reveal ; vi.advanceTimersByTime(5000) ; getByRole('list', { name: 'Mots les plus proposés' })
it('retire un mot du top 4 pendant la révélation', ...)
  // après la révélation, wordcloud:update sans le premier mot : la liste du top 4 ne le contient plus et contient le 5e
```

- [ ] Étape 2 : lancer `pnpm vitest run apps/web/src/screens/BigScreen.wordcloud.test.tsx`. Attendu : les deux nouveaux échouent.

- [ ] Étape 3 : dans `renderWordcloud`, remplacer `<WordCloud words=... />` par `<BigWordCloud key={question.id} words={current?.words ?? []} revealed={phase === 'reveal'} reducedMotion={reducedMotion} />` (avec `const reducedMotion = useReducedMotion()` en tête du composant) ; garder la ligne `wordcloudSummary` en dessous. Retirer l'import de `WordCloud` s'il n'est plus utilisé (garder `wordcloudSummary`).

- [ ] Étape 4 : lancer toute la suite web et les contrôles. Attendu : tout vert.

```bash
pnpm vitest run apps/web
pnpm lint
pnpm typecheck
```

- [ ] Étape 5 : vérification visuelle dans le vrai grand écran (compétence `run` ou serveur de dev) : une partie avec une question nuage, une dizaine de mots envoyés depuis deux téléphones simulés, fenêtre de 1920 × 1080 puis 1280 × 720. Vérifier : pas de chevauchement, pas de défilement, couleurs et mots verticaux présents, mots qui ne sautent pas, fin du chrono avec assombrissement et pastilles 4 → 1, retrait d'un mot depuis `HostLive` pendant la fin. Faire une capture de chaque état.

- [ ] Étape 6 : commit `feat(nuage): nouveau rendu du nuage sur le grand écran`.
