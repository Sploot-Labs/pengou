# Correctifs UX dashboard admin — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Corriger les findings de l'analyse UI/UX du dashboard : cascade couleur des liens (bug + hiérarchie), scalabilité des parties récentes, densité des cartes, chrome/statuts, et motif signature.

**Architecture:** Frontend uniquement (`apps/web`). Toujours via tokens de rôle. Tests Vitest + Testing Library. Runner : `pnpm vitest run <path>` (ciblé) ; web complet `pnpm vitest run apps/web/src`. PAS `pnpm test` (serveur e2e lent).

## Global Constraints
- Jamais de hex en dur ; primitives `--sploot-*` seulement dans `themes.css`.
- RGAA : texte ≥4.5:1, focus ≥3:1, cibles ≥44px, jamais couleur seule (statut = texte + éventuelle icône), `role=status/alert` conservés.
- Nom produit « Arena » conservé. Voix Sploot (≤1 🐾/écran).
- Commits fréquents ; web suite verte après chaque task.

---

## Task 1 : Cascade couleur des liens (bug bouton invisible + hiérarchie)

**Files:** Modify `apps/web/src/tokens.css`, `apps/web/src/prototype.css`. Test: `apps/web/src/theme/themes.test.ts` (garde-fou contenu).

**Cause:** `tokens.css:103` → `.prototype-root a { color: var(--brand) }` (spécificité 0,1,1) peint TOUT lien en ginger et écrase la couleur de texte des composants (0,1,0). Symptômes : (a) `SessionReport.tsx:160` `<a className="ab-button ab-button--primary">Exporter en CSV</a>` = texte ginger sur fond ginger → invisible ; (b) cartes/lignes du Home sont des `<Link>`, leurs titres (sans couleur propre) héritent du ginger → hiérarchie plate.

- [ ] **Step 1 — test garde-fou (échoue)** : dans `themes.test.ts`, ajouter un test lisant `tokens.css` :
```ts
it("la règle de couleur de lien de base ne s'applique qu'aux liens textuels (pas aux liens à classe)", () => {
  const tokensCss = _read(_url(new URL('../tokens.css', import.meta.url)), 'utf-8')
  expect(tokensCss).toContain('.prototype-root a:not([class])')
})
```
(`_read`/`_url` : réutiliser les imports déjà présents pour le garde-fou tokens.css.)
- [ ] **Step 2 — lancer, vérifier l'échec.** `pnpm vitest run apps/web/src/theme/themes.test.ts`
- [ ] **Step 3 — corriger la cascade** : dans `tokens.css`, restreindre la règle de base aux liens *sans classe* :
  `\.prototype-root a` → `\.prototype-root a:not([class])` (les liens inline textuels — ex. cross-links login/signup `<Link>` sans className — restent ginger). Les liens à classe (`ab-button`, `home-card`, `home-list__item`, `host-link-button`) posent désormais leur propre couleur.
- [ ] **Step 4 — donner leur couleur aux liens-composants** dans `prototype.css` :
  - `.home-card` : ajouter `color: var(--ink)` (déjà présent ? vérifier ; sinon ajouter). `.home-card__title` : `color: var(--ink-strong)`. Garder `.home-card__cta { color: var(--brand) }`.
  - `.home-list__item` : `color: var(--ink)`. `.home-list__title` : `color: var(--ink-strong)`.
  - Vérifier que `.ab-button--primary { color: var(--stage) }` s'applique bien désormais (le bouton/lien « Exporter en CSV » doit avoir un texte SOMBRE sur fond ginger). `.ab-button--ghost`/`--danger`/`--success` : vérifier leur `color` explicite.
  - `.host-link-button` : s'assurer d'une couleur lisible (ex. `var(--brand)` OK sur fond sombre — c'est un lien textuel, garder ginger).
- [ ] **Step 5 — vérifier** : `pnpm vitest run apps/web/src` vert. Décrire dans le report la vérification manuelle (grep : plus aucun composant-lien ne dépend de la règle de base pour sa couleur de texte).
- [ ] **Step 6 — commit** : `git commit -am "fix(theme): la couleur de lien de base ne cible que les liens textuels (bouton export lisible, hiérarchie titres)"`

---

## Task 2 : Parties récentes — filtre + limite (scalabilité)

**Files:** Modify `apps/web/src/screens/Home.tsx`, `apps/web/src/prototype.css`. Test: `apps/web/src/screens/Home.test.tsx`.

Aujourd'hui : liste plate de toutes les sessions, sans filtre/pagination.

- [ ] **Step 1 — test (échoue)** : dans `Home.test.tsx`, mocker `listSessions` pour renvoyer p.ex. 12 sessions de statuts variés ; asserter (a) qu'au chargement au plus 8 lignes de sessions sont rendues + un bouton « Voir toutes » ; (b) qu'un filtre « Terminées » ne laisse que les sessions `ended`. Utiliser les mocks existants du fichier (voir le test actuel) et `MotionProvider` autour de `<Home>`.
- [ ] **Step 2 — lancer, échec.** `pnpm vitest run apps/web/src/screens/Home.test.tsx`
- [ ] **Step 3 — implémenter dans `Home.tsx`** : 
  - État `sessionFilter: 'all' | 'active' | 'lobby' | 'ended'` et `showAllSessions: boolean`.
  - Rangée de boutons filtre (`role="group"` `aria-label="Filtrer les parties par statut"`), chaque bouton `aria-pressed`. Libellés : Toutes / En cours / En attente / Terminées.
  - Appliquer le filtre, puis limiter à 8 sauf si `showAllSessions`. Si plus de 8 après filtre, afficher `<Button variant="ghost">Voir toutes les parties ({n})</Button>` qui passe `showAllSessions=true`.
  - Conserver l'état vide et l'accessibilité existants.
- [ ] **Step 4 — styles** `prototype.css` : `.home-filters` (flex, gap, wrap) et un style de puce pour les boutons filtre (réutiliser `.ab-button--ghost` + un état actif via `aria-pressed`). Tokens only.
- [ ] **Step 5 — vérifier** `pnpm vitest run apps/web/src` vert.
- [ ] **Step 6 — commit** : `git commit -am "feat(admin): parties récentes filtrables + limitées (Voir toutes)"`

---

## Task 3 : Cartes de quiz — métadonnées + libellé d'action

**Files:** Modify `apps/web/src/screens/Home.tsx`, `apps/web/src/prototype.css`. Test: `apps/web/src/screens/Home.test.tsx`.

Les cartes ne portent que le titre + « Éditer → » (grand vide, quiz homonymes indistinguables). `Quiz` expose `updatedAt`, `description` (PAS `questionCount`).

- [ ] **Step 1 — test (échoue)** : asserter qu'une carte affiche la date de dernière modification (à partir de `updatedAt`) et, si présente, la description. Mock un quiz avec `updatedAt` et `description`.
- [ ] **Step 2 — lancer, échec.**
- [ ] **Step 3 — implémenter** dans la carte (`Home.tsx`) : sous le titre, `description` (déjà) puis une ligne méta `.home-card__meta` = `Modifié le {formatDate(q.updatedAt)}` (réutiliser un `Intl` `toLocaleDateString('fr-FR', { dateStyle: 'medium' })`). Renommer le CTA `Éditer →` → `Ouvrir →` (la carte est le point d'entrée : on y édite ET on lance). Retirer/réduire le `min-height:120px` si le vide subsiste.
- [ ] **Step 4 — styles** `prototype.css` : ajuster `.home-card` (gap, plus de grand vide). Tokens only.
- [ ] **Step 5 — vérifier** `pnpm vitest run apps/web/src` vert.
- [ ] **Step 6 — commit** : `git commit -am "feat(admin): cartes de quiz — date de modif + libellé Ouvrir"`

---

## Task 4 : Chrome des écrans de travail + statuts scannables

**Files:** Modify `apps/web/src/screens/HostEditor.tsx`, `apps/web/src/screens/SessionReport.tsx`, `apps/web/src/screens/Home.tsx`, `apps/web/src/prototype.css`. Test: web suite reste verte.

- [ ] **Step 1 — retirer la baseline marketing des écrans de travail** : dans les `brandline` de `HostEditor` et `SessionReport`, supprimer « Arena — quiz en direct, open-source · chez vous ou dans le cloud » (ligne de landing), CONSERVER la ligne utile « ← Retour à l'accueil · {quiz} » (HostEditor) / « ← Retour à l'accueil » (SessionReport). Home et Login/Signup gardent leur tagline.
- [ ] **Step 2 — badges de statut différenciés (accessibles)** : généraliser le patron « point + texte ». Dans `prototype.css`, ajouter des variantes de `.host-badge` par statut : un pseudo-élément/`•` en tête + une teinte de bordure/texte subtile par état — `ended`→neutre (`--ink-dim`), `active`→`--success`, `lobby`→`--warn`. Le TEXTE du statut reste (jamais couleur seule) et le contraste ≥4.5:1. Dans `Home.tsx` (liste) et `SessionReport.tsx`, appliquer la classe de variante selon `status` (mapping `Record<SessionStatus,'--...'>` ou classe `host-badge--{status}`).
- [ ] **Step 3 — vérifier** `pnpm vitest run apps/web/src` vert (adapter tout test qui asserait le texte de brandline retiré).
- [ ] **Step 4 — commit** : `git commit -am "polish(admin): baseline retirée des écrans de travail + badges de statut scannables"`

---

## Task 5 : Signature — motif des formes-réponses

**Files:** Modify `apps/web/src/screens/Home.tsx`, `apps/web/src/prototype.css`. Réutilise `AnswerShape` de `apps/web/src/ui.tsx`.

Le motif ▲◆●■ (logo, éditeur) est absent du dashboard. L'amener discrètement comme signature.

- [ ] **Step 1 — accent de carte** : sur chaque `.home-card`, ajouter un petit glyphe de forme décoratif (`aria-hidden`) en coin, en cyclant les 4 formes selon l'index (`['triangle','diamond','circle','square'][i % 4]`) avec la couleur `--ans-*` correspondante. Réutiliser `<AnswerShape>` (déjà `aria-hidden`). Discret (petit, opacité modérée) — ne pas gêner la lisibilité du titre.
- [ ] **Step 2 — état vide** : enrichir l'état vide « Pas encore de quiz… 🐾 » avec un petit assemblage des 4 formes (décoratif, `aria-hidden`) pour l'ancrer visuellement dans le monde Arena. Garder la copie et le 🐾 unique.
- [ ] **Step 3 — styles** `prototype.css` : `.home-card__glyph` (position, taille, opacité), et le bloc décoratif de l'état vide. Tokens only. Vérifier `prefers-reduced-motion` non impacté (statique, pas d'animation).
- [ ] **Step 4 — vérifier** `pnpm vitest run apps/web/src` vert (les glyphes `aria-hidden` ne doivent pas casser les assertions d'accessibilité existantes).
- [ ] **Step 5 — commit** : `git commit -am "feat(admin): motif formes-réponses en signature (cartes + état vide)"`

---

## Hors périmètre (nécessite backend/architecture — signalé au bilan)
- **Nombre de questions sur les cartes** : `listQuizzes` ne renvoie pas le compte → nécessite d'étendre l'endpoint serveur + type partagé.
- **« Lancer » directement depuis une carte** : nécessite de câbler le flux `host:create` (socket) hors de l'éditeur (dédup de la logique de `HostEditor`).
- **« Reprendre » une partie en cours depuis le Home** : pas de `host:reconnect` côté serveur (voir `routes.tsx`).
- **Refonte du hero** : laissé volontairement (risque de régression) — le motif signature (Task 5) apporte la personnalité.
