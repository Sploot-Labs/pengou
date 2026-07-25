# Refonte admin & unification du thème (anti-Kahoot)

Date : 2026-07-25
Statut : design validé (sections 1→5), prêt pour le plan d'implémentation.

## Contexte & problème

L'app a **deux identités visuelles qui se télescopent** :

- **`apps/web/src/tokens.css`** code en dur une palette « Arena Broadcast » — rose
  `#ff3d7f` + violet `#7a5cff` + midnight bleuté `#0e1230`. C'est, de l'aveu de
  l'utilisateur, **quasiment la gamme Kahoot**. Ce fichier est importé
  globalement dans `AppShell` et sert de *fallback* pour toute l'app via
  `.prototype-root`.
- Le dossier **`apps/web/src/theme/`** (`ThemeProvider`, `themes.css`,
  `tokens.brand.css`) est un système plus récent qui dérive les rôles produit
  (`--brand`, `--surface`, `--stage`…) des **primitives brand-kit Sploot**
  (`--sploot-ginger`, `--sploot-petrol`…, chaud, réactif light/dark).

Seuls **`Home`** (`data-theme="app"`) et **`BigScreen`**
(`data-theme="scene" scheme="dark"`) ont rejoint le système Sploot. Les **8 autres
écrans** (`HostEditor`, `HostLive`, `PlayerLive`, `Join`, `Login`, `Signup`,
`SessionReport`, `Podium`) rendent encore avec la palette Kahoot en dur. D'où le
mélange visible.

Par-dessus, le **dashboard admin (`Home`)** est fonctionnel mais plat : header +
`<h1>Accueil</h1>` + deux listes empilées, peu de hiérarchie, pas d'accueil
chaleureux.

## Objectifs

1. **Se démarquer de Kahoot** : supprimer le rose/violet et unifier toute l'app
   sur l'identité Sploot (ginger + petrol, biais chaud), distinctive.
2. **Une seule source de vérité couleur** : plus de palette parallèle.
3. **Refondre l'UX des écrans admin** (tous) : plus friendly, mieux hiérarchisé.
4. **Accessibilité RGAA** renforcée et vérifiée en clair comme en sombre.

Non-objectif : renommer le produit (« Arena » est conservé — le grief portait sur
les couleurs, pas le nom). Non-objectif : refonte gameplay/logique.

## Section 1 — Architecture des tokens (approche retenue : A1)

**A1 — une seule source de vérité.**

- `tokens.css` **perd ses primitives couleur** (`--brand`, `--brand-2`, `--stage*`,
  `--surface*`, `--ink*`, `--gold/silver/bronze`, `--warn`, `--ans-*`, `--success`,
  `--danger`, `--grad-brand`, et la typo qui duplique le brand-kit). Il ne garde
  que le **non-couleur réellement partagé** : échelle typographique `--fs-*`,
  espacements `--space-*`, rayons `--radius-*`, durées `--transition-*`, plus le
  reset/base et les blocs `prefers-reduced-motion` / `.visually-hidden` /
  focus-visible (dont la *couleur* devient un token de rôle, cf. §3).
- Tous les **rôles couleur** proviennent de `themes.css` (dérivés des primitives
  Sploot), qui gagne les tokens réponse/podium aujourd'hui définis dans
  `tokens.css` (`--ans-*`, `--gold/silver/bronze`) — voir §2.
- **Défaut sain** : `AppShell` pose `data-theme="app"` sur `.prototype-root`, pour
  qu'un écran non wrappé ait toujours des rôles définis (fin du fallback Kahoot).
- Chaque écran de jeu est ensuite wrappé dans le bon `ThemeProvider` (§4).

Écartées : **A2** (aliaser les hex de `tokens.css` vers `var(--sploot-*)` — deux
fichiers définissent encore les mêmes rôles, reste confus) ; **A3** (re-teinter sur
place — garde l'odeur « palette parallèle » et sous-exploite le split app/scene).

## Section 2 — Palette anti-Kahoot

Supprimé : rose `#ff3d7f`, violet `#7a5cff`, dégradé rose→violet, midnight `#0e1230`.

Nouveaux rôles (déjà en place dans `themes.css`, généralisés) :

| Rôle | Source Sploot | Note |
|---|---|---|
| `--brand` | `--sploot-ginger` | signature chaude, remplace le rose |
| `--brand-2` | `--sploot-petrol` (`-soft` en scene) | teal, remplace le violet |
| `--grad-brand` | `linear-gradient(135deg, ginger, petrol)` | |
| `--stage` (scene) | `--sploot-bg` `#17150F` | **dark chaud**, plus le midnight bleu |
| `--success` / `--warn` / `--danger` | `--sploot-ok` / `-warn` / `-bad` | |

- **Podium** : `--gold/silver/bronze` déplacés dans `themes.css`, or retuné en
  laiton chaud, **réservé au classement** (jamais réutilisé comme accent).
- **Couleurs de réponse** (`--ans-triangle/diamond/circle/square` + `-ink`) :
  déplacées dans `themes.css`, **4 couleurs conservées** (nécessité fonctionnelle :
  couleur **+ forme + label**), retunées pour vivre dans le monde chaud tout en
  gardant **≥4.5:1** avec leur encre (l'ambre garde une encre sombre). ⚠️ Seul
  endroit qui ressemblera encore un peu à Kahoot ; le différenciateur forme+libellé
  (déjà présent dans `ui.tsx`) reste et suffit à lever l'ambiguïté RGAA.

## Section 3 — Refonte UX des écrans admin (tous)

Écrans concernés : **`Home`, `HostEditor`, `Login`, `Signup`, `SessionReport`**
(zone `app`, chaude, réactive light/dark).

### Socle partagé

- **Composant header/shell réutilisable** extrait (logo + brandline + action
  compte), partagé par `Home` et `HostEditor` a minima. Login/Signup gardent un
  header allégé cohérent.
- **Voix Sploot** dans les états vides et l'accueil (« à hauteur de pattes », un
  seul clin d'œil 🐾 par écran, sérieux d'abord — cf. `brand-kit/voice-and-tone.md`).

### `Home`

Cible :

```
◆ Arena           quiz en direct, chez vous / cloud        [⏻]
────────────────────────────────────────────────────────────
Bonjour 👋   Prêt à lancer une partie ?      [ + Nouveau quiz ]
Mes quiz
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Titre    │ │ Titre    │ │ Titre    │   grille de cartes
│ 8 quest. │ │ desc…    │ │ 12 quest.│   responsive
│ [Éditer] │ │ [Éditer] │ │ [Éditer] │
└──────────┘ └──────────┘ └──────────┘
Parties récentes
• Quiz X  PIN 4821 · 23 juil. · 12 joueurs   [◼ Terminée]
```

- Hero d'accueil + CTA **« Nouveau quiz » primaire proéminent** (plus un lien ghost
  qui toggle). Le formulaire de création reste un disclosure (`aria-expanded`,
  focus géré) mais déclenché par un bouton primaire.
- Quiz en **grille de cartes responsive** (titre, description, nb de questions,
  action « Éditer ») au lieu d'une liste plate.
- Parties récentes : liste scannable, badge statut **icône + texte**.

### `HostEditor`

- Applique le header partagé et la zone `app`.
- Améliore la hiérarchie de la liste de questions / du panneau d'édition (le
  layout `host-layout` existe déjà en 2 colonnes ; on soigne espacements, cartes,
  états vides, affordance des actions primaires/destructives).

### `Login` / `Signup`

- Layout centré « carte » chaleureux, cohérent entre les deux, voix Sploot légère,
  liens croisés clairs.

### `SessionReport`

- Mise en page « rapport » lisible : résumé en tête (cartes de stats), tableau/liste
  scannable, badges statut icône+texte, états vides/erreur soignés.

### Accessibilité (RGAA) — commun à tous

- Un seul `<h1>` par écran, landmarks (`header`/`main`) propres, titres de section.
- **Focus visible** retuné en token de rôle (`--focus`, dérivé Sploot) avec **≥3:1**
  contre le fond, dans les deux schémas — remplace l'outline gold codée en dur.
- Cibles tactiles **≥44px** (cartes, boutons, liens de liste).
- Jamais la couleur seule : statuts = **icône + texte** (déjà le cas pour les
  réponses via forme+label).
- États chargement/erreur/vide avec `role="status"`/`role="alert"` (déjà présents,
  conservés).
- **Contrastes ≥4.5:1** (texte) vérifiés en **app-clair ET app-sombre**.

## Section 4 — Migration des écrans de jeu

Wrapper chaque écran non migré dans le bon `ThemeProvider`, puis retirer toute
dépendance aux valeurs Arena en dur et faire une QA visuelle :

- **`app`** (chaud) : `HostEditor`, `Login`, `Signup`, `SessionReport`.
- **`scene` / `dark`** (sombre énergique) : `HostLive`, `PlayerLive`, `Join`,
  `Podium`. (`BigScreen` déjà en `scene`.)

## Section 5 — Tests

- **Ajuster l'existant** : `theme/themes.test.ts`, `screens/BigScreen.motion.test.tsx`
  (vérifie `data-theme="scene"`), tests focus RGAA existants.
- **Nouveaux** :
  - chaque route/écran monte sous le `data-theme` attendu (`app` vs `scene`) ;
  - assertions de contraste sur les rôles clés (texte/fond) dans les deux schémas ;
  - `Home` : flux « créer un quiz » + rendu de la grille de cartes ;
  - garde-fou : `tokens.css` ne définit plus de primitive couleur Kahoot (test de
    contenu, façon `themes.test.ts`).
- Outillage : Vitest + Testing Library (déjà en place).

## Risques & points d'attention

- **Volume** : 5 écrans admin redessinés + 8 écrans à migrer + refonte token =
  chantier large. Découper le plan en lots (tokens → migration → Home → autres
  écrans admin → tests) pour des checkpoints nets.
- **Régressions visuelles** sur les écrans de jeu déjà « jolis » : QA écran par
  écran après migration.
- **Contraste des `--ans-*` retunées** : revalider chaque couleur/encre au ratio
  RGAA après re-teinte.
- Le composant header partagé ne doit pas casser le montage unique de
  `GameSocketProvider` (cf. `routes.tsx`) — c'est de la présentation pure.
