# Abstraction animations / son / vidéo — design

- **Date** : 2026-07-23
- **Produit** : Arena (quiz live open-source, `apps/web`)
- **Auteur** : brainstorming architecte frontend
- **Statut** : validé (design), prêt pour plan d'implémentation

## 1. Problème & objectif

Aujourd'hui `apps/web` n'a **aucune animation orchestrée**, aucun son, aucune vidéo :
seulement quelques `transition` de hover, un keyframe `ab-scan` (scanline du PIN) et
des transitions de hauteur/largeur sur les barres. Les barres de distribution
apparaissent d'un coup, les scores changent sèchement, le passage au podium est brut.

**Objectif** : mettre en place une **couche d'abstraction** permettant d'ajouter
facilement, *partout* dans l'app, des animations (graphiques animés, transitions de
phase, micro-interactions), des sons et des vidéos — sans disperser la logique dans
chaque écran, en respectant l'accessibilité déjà en place (RGAA, `prefers-reduced-motion`,
live-regions ARIA) et en unifiant le thème graphique sur le **brand-kit Sploot Labs**.

### Décisions de cadrage (validées)

1. **Marque / theming** : le thème devient un concept de première classe. Socle =
   primitives du brand-kit Sploot Labs (`brand-kit/design-tokens.css`). On prévoit
   plusieurs thèmes produit : `scene` (grand écran, sombre assumé) et `app` (éditeur /
   home / mobile). Fusion « brand-kit + mode scène dérivé ».
2. **Surfaces** : les 4 sont dans le périmètre — moments de jeu (grand écran), retour
   joueur (mobile), app « calme » (éditeur/home), son & vidéo d'ambiance. L'abstraction
   doit être *surface-agnostique*.
3. **Techno** : **Framer Motion** comme moteur d'orchestration, **caché** derrière une
   couche maison. Confetti via canvas dédié, son via Web Audio, vidéo via `<video>`.
   Les écrans n'importent **jamais** Framer Motion directement.

## 2. Principe directeur

Comme toute l'app est déjà *event/phase-driven* (`lobby → question → reveal →
scoreboard → podium`, pilotée par les events socket dans `useGameSocket`),
l'abstraction n'est **pas** « une lib d'animation » mais un **registre de cues** :

- un **cue** = un moment sémantique nommé (`phase.enter:podium`, `answer.correct`, `score.increment`) ;
- un **effet** = ce qui se joue à ce moment (animation + son + vidéo) ;
- le **registre** = la table unique qui relie cues → effets.

Les écrans **émettent des cues** ; ils ne savent rien de ce qui se joue. Ajouter une
animation, un son ou une vidéo « partout » = ajouter/éditer **une entrée du registre**,
sans toucher aux écrans. C'est ça, le « abstrait, partout, facile ».

## 3. Architecture en couches

Quatre couches ; une couche ne dépend que de celle du dessous.

```
ÉCRANS      BigScreen · PlayerLive · HostLive · Home · Editor   → importent SEULEMENT la couche 3
3. CUES     useCue() · <Cue> · registry.ts (moments → effets)   → l'abstraction publique
2. PRIMITIVES  <Reveal> <Stagger> <CountUp> <AnimatedBar>
               <Confetti> · SoundManager · <MediaOverlay>       → briques réutilisables
1. FONDATIONS  motion tokens · ThemeProvider · reduced-motion
               (Framer Motion + canvas + Web Audio = cachés)    → moteurs, jamais exposés
```

**Règle d'or (garde d'architecture)** : un écran n'importe jamais `framer-motion`, ni le
canvas de confetti, ni Web Audio. Il n'importe que `motion/` (couche 3). Un test/lint
interdit `import 'framer-motion'` hors de `apps/web/src/motion/`. C'est ce qui garde le
moteur remplaçable et l'usage homogène dans le temps.

### Arborescence

```
apps/web/src/
  theme/
    tokens.brand.css      # primitives brand-kit (import/alias de brand-kit/design-tokens.css)
    tokens.motion.css     # durées, easings, distances (nouveaux)
    themes.css            # [data-theme="scene"|"app"] : primitives → rôles
    ThemeProvider.tsx     # contexte + application de data-theme / data-scheme
  motion/
    MotionProvider.tsx    # monte le moteur, expose le registre, lit prefers-reduced-motion
    registry.ts           # LA table cue → bundle d'effets (cœur de l'abstraction)
    cues.ts               # taxonomie typée des cues
    useCue.ts             # hook: cue(name, ctx) ; composant <Cue on=… when=…>
    PhaseTransition.tsx   # wrapper AnimatePresence (Framer caché) pour le switch de phase
    primitives/
      Reveal.tsx  Stagger.tsx  CountUp.tsx  AnimatedBar.tsx
      Confetti.tsx        # canvas
      MediaOverlay.tsx    # vidéo
    sound/
      SoundManager.ts  useSound.ts  sounds.ts
    index.ts              # surface publique importée par les écrans
```

`tokens.css` et `prototype.css` actuels sont **conservés** et migrés progressivement
(voir §9). Rien ne casse le jour 1.

## 4. Tokens & thèmes (theming de première classe)

Deux niveaux de variables, comme le fait déjà le brand-kit :

- **Primitives** (valeurs brutes brand-kit) : `--sploot-ginger`, `--sploot-petrol`,
  `--sploot-bg`, `--sploot-surface`, `--sploot-text`…
- **Rôles** (sémantique produit, ce que le CSS consomme) : `--brand`, `--brand-2`,
  `--stage`, `--surface`, `--ink`, `--ink-dim`… — **déjà les noms utilisés par
  `prototype.css`**. La migration = re-pointer les rôles vers les primitives, sans
  réécrire les ~1992 lignes existantes.

### Deux axes orthogonaux (résolution de la collision de nommage)

Le brand-kit utilise déjà `data-theme="light|dark"` pour le **schéma de couleur**.
Notre thème produit est un **axe différent**. On sépare donc explicitement :

- **Schéma** (clair/sombre) : `data-scheme="light|dark"` (ou `prefers-color-scheme` par
  défaut) → choisit la palette brand-kit. *Renommage de l'attribut brand-kit
  `data-theme` → `data-scheme` dans notre intégration pour lever l'ambiguïté.*
- **Thème produit** : `data-theme="app|scene"` → mappe les primitives (de la palette
  choisie) vers les rôles produit.

```css
/* themes.css */
:root[data-theme="app"] {          /* éditeur, home, mobile — suit le schéma clair/sombre */
  --stage:    var(--sploot-bg);
  --surface:  var(--sploot-surface);
  --surface-2:var(--sploot-surface-2);
  --ink:      var(--sploot-text);
  --ink-dim:  var(--sploot-muted);
  --line:     var(--sploot-line);
  --brand:    var(--sploot-ginger);
  --brand-2:  var(--sploot-petrol);
  --success:  var(--sploot-ok);
  --warn:     var(--sploot-warn);
  --danger:   var(--sploot-bad);
}
:root[data-theme="scene"] {        /* grand écran — sombre assumé quel que soit le schéma */
  --stage:    var(--sploot-bg);    /* la sous-arbre BigScreen force data-scheme="dark" */
  --surface:  var(--sploot-surface);
  --brand:    var(--sploot-ginger);      /* le ginger reste le seul pop */
  --brand-2:  var(--sploot-petrol-soft);
}
```

`BigScreen` monte sa sous-arborescence avec `data-scheme="dark"` **forcé** (le projecteur
est sombre quel que soit le réglage OS de la salle) + `data-theme="scene"`. Le reste de
l'app est `data-theme="app"` et suit `prefers-color-scheme`.

**Ajouter un thème = ajouter un bloc `[data-theme="x"]`**, zéro JS.

### Contraintes de contraste (à re-valider)

Les tokens `--ans-*` (formes de réponse) de `tokens.css` ont été assombris pour
atteindre ≥ 4.5:1 avec le texte blanc sur fond sombre. En thème `app` (fond clair),
ces ratios doivent être **re-vérifiés** ; prévoir un jeu `--ans-*` par schéma si besoin.
Contrainte RGAA : la couleur n'est jamais le seul cue (forme + label conservés partout).

### Motion tokens (nouveaux)

```css
/* tokens.motion.css — toutes les animations parlent le même langage */
:root {
  --dur-instant: 90ms;  --dur-quick: 160ms;  --dur-base: 240ms;
  --dur-slow: 420ms;    --dur-scene: 700ms;                 /* transitions de phase grand écran */
  --ease-out:    cubic-bezier(.22, 1, .36, 1);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);           /* léger overshoot, célébration */
  --lift-1: 2px;  --lift-2: 8px;  --rise: 16px;
}
```

## 5. Moteur de cues (couche 3 — l'abstraction publique)

### Taxonomie typée, ouverte

```ts
// cues.ts — nommage: <domaine>.<moment>[:<variante>]
export type Cue =
  | `phase.enter:${'lobby' | 'question' | 'reveal' | 'scoreboard' | 'podium'}`
  | 'answer.submit' | 'answer.correct' | 'answer.incorrect'
  | 'score.increment' | 'player.join'
  | 'podium.celebrate' | 'timer.urgent'
  | (string & {})   // ouvert : un cue inconnu = no-op silencieux, jamais une erreur
```

### Effet & registre

```ts
// registry.ts
export interface CueContext {
  el?: HTMLElement            // ancre optionnelle pour l'animation
  [k: string]: unknown        // données du moment (score delta, shape…)
}
export interface CueEffect {
  animation?: (ctx: CueContext) => void      // WAAPI/Framer, joué par le moteur (couche 1)
  sound?: SoundId                            // clé du catalogue (indirection)
  media?: { src: string; mode: 'overlay' | 'background' }
  reducedMotion?: 'skip' | 'crossfade'       // défaut: skip le visuel, GARDE le son
}
export const registry: Partial<Record<Cue, CueEffect>> = {
  'phase.enter:podium': { animation: sweepIn, sound: 'fanfare', media: { src: 'confetti-bg', mode: 'overlay' } },
  'answer.correct':     { animation: pulseGreen, sound: 'ding' },
  'answer.incorrect':   { animation: shake,      sound: 'buzz' },
  'timer.urgent':       { sound: 'tick', reducedMotion: 'skip' },
  // ajouter une animation "partout" = ajouter UNE ligne ici
}
```

### API vue par les écrans

```tsx
// impérative (dans un effet, sur event socket)
const cue = useCue()
useEffect(() => { cue('phase.enter:podium') }, [phase])

// déclarative (dans le JSX)
<Cue on="answer.correct" when={isCorrect} />
```

`MotionProvider` : lit `prefers-reduced-motion` **une fois**, expose `cue()`, route chaque
cue vers le registre → déclenche animation (couche 1) + son (SoundManager) + média
(MediaOverlay). **Un cue non enregistré = no-op** (jamais un crash) → on peut semer des
`cue()` partout avant même d'avoir conçu l'effet correspondant.

## 6. Primitives (couche 2)

Toutes sont **motion-safe** (lisent le contexte `MotionProvider`) et **theme-aware**
(consomment les rôles CSS, aucune couleur en dur).

- **`<Reveal as delay from>`** — apparition (fade + rise). Reduced-motion → rendu
  immédiat, opacité 1, aucun transform.
- **`<Stagger step>`** — révèle une liste en cascade (barres, joueurs, classement).
- **`<CountUp value format>`** — nombre qui s'incrémente (scores, « X/Y ont répondu »).
  Reduced-motion → valeur finale directe. `tabular-nums` (déjà dans le brand-kit).
- **`<AnimatedBar value max color grow>`** — barre qui *pousse* via `transform: scaleY`
  (composité 60fps) plutôt que `height`. Remplace l'apparition brute des barres de
  distribution. Généralisable à toute jauge / mini-graphe.
- **`<Confetti>`** — canvas de particules en overlay (aucun reflow DOM), monté seulement
  au cue `podium.celebrate`, auto-nettoyé, `aria-hidden`, coupé en reduced-motion.
- **`<PhaseTransition phase>`** — enveloppe le switch de phase ; `AnimatePresence`
  (Framer caché) fait sortir/entrer les phases. **Ne touche pas** à la gestion de focus
  existante (les `headingRef` restent maîtres, RGAA 2.4.3).

### Graphiques animés — pattern générique

Pas de lib de charting. Un contrat commun **`AnimatedValue`** (valeur cible +
interpolation motion-safe) réutilisé par `AnimatedBar`, `CountUp` et `TimerRing`.
`TimerRing` (déjà SVG) migre pour animer `stroke-dashoffset` en continu au lieu du saut
par pas de 250 ms. Un seul modèle → anneau fluide, barres qui poussent, compteurs qui
roulent, extensible à un futur graphe (courbe de progression, heatmap) sans dépendance.

## 7. Son — `SoundManager`

Web Audio derrière une API minuscule. Contraintes réelles gérées par conception :

- **Muet par défaut, opt-in explicite.** L'autoplay policy interdit le son avant
  interaction : le manager se « débloque » (`unlock()`) au **premier geste utilisateur**
  (clic « Lancer la partie » hôte, « Rejoindre » joueur) et n'émet rien avant. Toggle
  🔊/🔇 persistant (`localStorage`) sur grand écran et mobile.
- **Préchargement** du catalogue au montage ; lecture sans latence.
- **Catalogue typé** = indirection : les cues référencent une clé, pas un fichier.

```ts
// sounds.ts
export const sounds = {
  ding: '/sfx/ding.mp3', buzz: '/sfx/buzz.mp3', tick: '/sfx/tick.mp3',
  fanfare: '/sfx/fanfare.mp3', lobby: '/sfx/lobby-loop.mp3',
} as const
export type SoundId = keyof typeof sounds

// API
manager.unlock()                       // au 1er geste
manager.play('ding')
manager.loop('lobby', { fade: 400 })
manager.setMuted(true)
```

Le son respecte reduced-motion **séparément** du visuel : par défaut un cue garde son son
même si l'animation est coupée (reduced-motion ≠ sans audio) ; configurable par cue.

## 8. Vidéo — `<MediaOverlay>`

Fonds animés et *stingers* (courtes transitions) sur le grand écran.

- `<video>` HTML **muet + `playsInline` + `loop`** pour les fonds (autoplay muet
  autorisé), au-dessus de `--stage`, sous le contenu.
- Mode `overlay` (stinger ponctuel qui se joue puis se retire) vs `background` (boucle
  d'ambiance pendant une phase).
- Fallback gracieux : vidéo absente / reduced-data → dégradé de marque (`--grad-brand`),
  jamais d'écran cassé. `aria-hidden`, purement décoratif.

```tsx
<MediaOverlay src="scene-loop" mode="background" active={phase === 'lobby'} />
// aussi pilotable depuis le registre: media: { src, mode } sur un cue
```

## 9. Intégration dans les écrans (diff minimal)

On n'ajoute pas d'animation dans les écrans, on ajoute des **points d'émission de cue**.

- **`AppShell`** : monte `<ThemeProvider>` + `<MotionProvider>` autour de l'`<Outlet>`.
- **`BigScreen`** : `data-scheme="dark"` + `theme="scene"`. Dans les effets socket
  existants, ajouter `cue(...)` là où la phase change déjà (`offReveal` →
  `cue('phase.enter:reveal')`, `offPodium` → `cue('phase.enter:podium')`…). Envelopper
  le switch de phase d'un `<PhaseTransition>`. Barres → `<AnimatedBar>`, scores →
  `<CountUp>`. ~15 lignes, aucune logique métier déplacée.
- **`PlayerLive`** : `cue('answer.correct'|'answer.incorrect')` au reveal,
  `cue('timer.urgent')` quand `remaining ≤ 5`. Feedback visuel + son + haptique optionnel
  (`navigator.vibrate`, gated reduced-motion).
- **`Home` / `HostEditor`** : `theme="app"`, quelques `<Reveal>` / `<Stagger>`.

La bascule auto `reveal→scoreboard` (`REVEAL_HOLD_MS`) et le timer dérivé de `startedAt`
restent **inchangés** : l'animation habille la machine d'état serveur-autoritaire, elle
n'en est jamais la source de vérité.

## 10. Accessibilité & reduced-motion (non négociable)

- `prefers-reduced-motion` lu **une fois** dans `MotionProvider`, exposé en contexte ;
  chaque primitive s'y réfère. Plus de dépendance au hack `animation-duration: 0.001ms`.
  Défaut par cue : `skip` le visuel, **garde** le son.
- Les **live-regions ARIA existantes** (`TimerRing`, annonces lobby/reveal) restent la
  source d'info accessible ; les animations sont toujours `aria-hidden` et **jamais** le
  seul porteur d'information (forme + label + texte conservés).
- **Son opt-in**, jamais imposé, jamais avant geste utilisateur, toggle persistant.
- **Vidéo décorative** : `aria-hidden`, muette, coupée en reduced-motion, fallback dégradé.
- **Focus par phase** (RGAA 2.4.3) piloté par les `headingRef` actuels ; `PhaseTransition`
  n'y touche pas.

## 11. Tests

- **Registre** (unit) : chaque cue mappe un effet valide ; cue inconnu = no-op ;
  `reducedMotion` respecté par cue.
- **SoundManager** (unit) : rien avant `unlock()` ; `muted` coupe tout ; catalogue résolu.
- **Primitives** (unit/RTL) : `<CountUp>` affiche la valeur finale en reduced-motion ;
  `<AnimatedBar>` rend la bonne hauteur ; `<Reveal>` rend le contenu immédiatement.
- **Non-régression e2e** : les parcours existants (partie complète dans le navigateur)
  restent verts. Ajouter un test « reduced-motion : aucune animation, contenu et
  annonces ARIA intacts ».
- **Garde d'architecture** : test/lint interdisant `import 'framer-motion'` hors de
  `apps/web/src/motion/`.

## 12. Plan de migration incrémental (rien ne casse le jour 1)

1. **Tokens** : créer `theme/` ; re-pointer les rôles (`--brand`, `--stage`…) vers les
   primitives brand-kit ; renommer l'attribut de schéma en `data-scheme` ;
   `data-theme="app"` par défaut, `"scene"` sur BigScreen. `prototype.css` intact.
   Re-valider les contrastes `--ans-*` en thème clair.
2. **Socle** : `MotionProvider` + registre **vide** (tous les cues = no-op) monté dans
   `AppShell`. Zéro effet visible, filet en place.
3. **Primitives** : `<Reveal>/<Stagger>/<CountUp>/<AnimatedBar>` + `SoundManager` (muet).
   Tests unitaires.
4. **Semis de cues** : poser les `cue()` dans les écrans (toujours no-op). Diff revu isolément.
5. **Remplir le registre** surface par surface, dans l'ordre validé : grand écran
   (moments de jeu) → mobile → app calme → son/vidéo. Chaque entrée = un incrément
   livrable et testable indépendamment.

Chaque étape est mergeable seule et réversible (vider le registre = revenir à l'app actuelle).

## 13. Dépendances ajoutées

- `framer-motion` (orchestration de phase, caché derrière `motion/`).
- Aucune lib de son/charting : Web Audio et canvas natifs.
- Assets à produire (hors code) : quelques `.mp3` (sfx + boucle lobby), 1-2 vidéos
  d'ambiance grand écran optionnelles. Tant qu'ils sont absents, les cues média/son
  correspondants sont simplement no-op (dégradé/silence).

## 14. Hors périmètre (YAGNI)

- Éditeur d'animations / timeline visuelle.
- Personnalisation d'animations par quiz (thème par tenant) — possible plus tard via le
  même mécanisme `data-theme`, non conçu ici.
- Synchronisation audio multi-écran (le son de chaque appareil est indépendant).
- Bibliothèque de charting générique (on livre le pattern `AnimatedValue`, pas une lib).
