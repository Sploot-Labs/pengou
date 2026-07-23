# Couche motion — comment ajouter une animation / un son / une vidéo

## Ajouter un effet à un moment EXISTANT
Éditer `registry.ts` : une entrée `cue → { animation?, sound?, media?, reducedMotion? }`.
Aucun écran à toucher.

## Ajouter un NOUVEAU moment
1. Ajouter le nom au type `Cue` (`cues.ts`) — optionnel (l'union est ouverte).
2. Émettre depuis l'écran : `const cue = useCue(); cue('mon.moment')` ou `<Cue on="mon.moment" when={…} />`.
3. Enregistrer son effet dans `registry.ts`.

## Assets
- Sons : `apps/web/public/sfx/<clé>.mp3`, déclarés dans `sound/sounds.ts`.
- Vidéos : `apps/web/public/media/<src>.mp4` (fallback dégradé si absent).

## Règles
- Ne JAMAIS importer `framer-motion`, le canvas ou Web Audio hors de `motion/`
  (garde : `architecture.test.ts`).
- Toute animation est `aria-hidden` et jamais le seul porteur d'info.
- Le visuel est coupé en reduced-motion ; le son passe par défaut (configurable
  par cue via `reducedMotion`).
- Le son est opt-in : `sound.unlock()` sur un geste utilisateur avant toute lecture.

## Thèmes
`<ThemeProvider theme="app"|"scene" scheme?="light"|"dark">`. Ajouter un thème =
un bloc `[data-theme="x"]` dans `theme/themes.css`.
