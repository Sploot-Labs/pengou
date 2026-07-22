# Sploot Labs — Récap dev (handoff)

> Tout ce dont tu as besoin pour coder une UI « on-brand » : couleurs, typo, tokens, règles logo.
> Fichiers prêts à l'emploi dans ce dossier : [`design-tokens.css`](./design-tokens.css) · [`design-tokens.json`](./design-tokens.json) · [`tailwind.tokens.js`](./tailwind.tokens.js)

---

## 1. Couleurs

Duo **chaud (ginger) + froid (petrol)**. Le ginger est le **seul** pop couleur. Le petrol est structurel/technique. Le reste = neutres chauds. Chaque token a une valeur **light** et **dark**.

| Token | Rôle | Light | Dark |
|---|---|---|---|
| `--sploot-ginger` | Accent principal (le pop) | `#D9772B` | `#E88A3C` |
| `--sploot-ginger-deep` | Ombres/oreilles, hover | `#B85F1E` | `#C86E24` |
| `--sploot-petrol` | Secondaire technique, liens, structure | `#1E5F60` | `#4FA3A0` |
| `--sploot-petrol-soft` | Petrol atténué | `#2F7C7B` | `#6FBDB8` |
| `--sploot-cream` | Cream « bib » (aplat mascotte) | `#F5EDDD` | `#F5EDDD` |
| `--sploot-bg` | Fond de page | `#ECE7DD` | `#17150F` |
| `--sploot-surface` | Cartes / surfaces | `#F5F1E9` | `#201D15` |
| `--sploot-surface-2` | Surface enfoncée | `#E4DECF` | `#2A261C` |
| `--sploot-text` | Texte principal | `#241F18` | `#EDE7DA` |
| `--sploot-muted` | Texte secondaire | `#6E665A` | `#A29A8B` |
| `--sploot-line` | Bordures / séparateurs | `#D8D0C1` | `#34301F` |
| `--sploot-ok` | Sémantique succès | `#3F7D57` | `#5FA778` |
| `--sploot-warn` | Sémantique alerte | `#C98A2E` | `#E0A64B` |
| `--sploot-bad` | Sémantique erreur | `#C0503A` | `#D96A52` |

**Règles :**
- Le sémantique (ok/warn/bad) est **séparé** de l'accent : ne jamais utiliser le ginger pour dire « succès ».
- Sur fond ginger, texte en `#FFFFFF` (ratio OK). Sur cream/paper, texte en `--sploot-text`.
- Dark mode traité au même niveau que light — c'est la vue par défaut de la cible (devs).

---

## 2. Typographie

Trois rôles, **fontes open source** (cohérent avec l'ADN de la maison). Self-host via [Fontsource](https://fontsource.org/) ou Google Fonts.

| Rôle | Fonte | Fallback stack | Usage |
|---|---|---|---|
| **Titre** | [Bricolage Grotesque](https://fontsource.org/fonts/bricolage-grotesque) | `"Bahnschrift", ui-sans-serif, system-ui, sans-serif` | H1–H3, wordmark, labels. Weights 600/700. Léger negative tracking (`-0.01em`). Titres en **UPPERCASE** ou bas de casse, jamais Title Case. |
| **Texte** | [Hanken Grotesk](https://fontsource.org/fonts/hanken-grotesk) | `ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif` | Corps, UI. Weights 400/500/600. Ligne ~1.6, largeur ~65ch. |
| **Code** | [JetBrains Mono](https://fontsource.org/fonts/jetbrains-mono) | `ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace` | Code, badges, données, chips. |

```css
--font-display: "Bricolage Grotesque", "Bahnschrift", ui-sans-serif, system-ui, sans-serif;
--font-body:    "Hanken Grotesk", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
--font-mono:    "JetBrains Mono", ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
```

**Échelle de type** (base 16px, ratio ~1.25) : `12 · 14 · 16 · 20 · 25 · 31 · 39 · 49px`.
Chiffres alignés en colonne → `font-variant-numeric: tabular-nums`.
Labels/eyebrows en mono, `text-transform: uppercase`, `letter-spacing: 0.12em`.

---

## 3. Layout & divers

| Token | Valeur |
|---|---|
| Rayon carte (`--r`) | `14px` |
| Rayon pill/chip | `999px` |
| Rayon badge logo | `26/100` du côté (≈ `rx: 26` sur viewBox 100) |
| Largeur max contenu | `1080px` |
| Gap grille | `18px` |

**Concept directeur : « low center of gravity ».** Silhouettes basses et larges, lignes de base horizontales fortes, éléments posés « au sol ». Éviter les cartes qui flottent — préférer l'ancrage.

**Motion :** discrète. Un `bob` léger sur la mascotte, hover micro. Respecter `prefers-reduced-motion`.

---

## 4. Logo — règles rapides

Assets dans [`./assets/`](./assets/). SVG = source de vérité, scalable.

- **Badge visage** (`logo-badge.svg`) → avatar GitHub, favicon, app icon. Version N&B : `logo-badge-mono.svg`.
- **Mark « sploot vu du ciel »** (`mark-sploot.svg`) → marque signature, stickers, watermark.
- **Wordmark** → toujours en **bas de casse** : `sploot labs`. Le `oo` peut passer en ginger (les yeux du corgi).
- **Avatar rond** (`avatar-round.svg`) → réseaux sociaux.
- **Mascotte** (`mascot-corgi.svg`) → illustrations, hero, docs.

**À ne pas faire :** étirer, changer les couleurs hors palette, ajouter une queue au corgi (Pembroke = sans queue), Title Case sur le wordmark, empiler les références geek.

**Preuve 32px :** le badge doit rester lisible en favicon. Tester avant de figer.

---

## 5. Intégration express

```bash
# CSS vanilla
import "./brand-kit/design-tokens.css";

# Tailwind (v3) — dans tailwind.config.js
const sploot = require("./brand-kit/tailwind.tokens.js");
module.exports = { theme: { extend: sploot } };
```

Dark mode : les tokens réagissent à `@media (prefers-color-scheme)` **et** à `data-theme="dark|light"` sur `:root` (toggle manuel). Voir `design-tokens.css`.
