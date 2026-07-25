# Refonte admin & unification du thème (anti-Kahoot) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unifier toute l'app web sur l'identité Sploot (ginger/petrol, chaud), supprimer la palette rose/violet façon Kahoot, et refondre l'UX de tous les écrans admin, RGAA renforcé.

**Architecture:** Une seule source de vérité couleur : `themes.css` dérive tous les rôles des primitives brand-kit `--sploot-*` ; `tokens.css` ne garde que le non-couleur (typo/espacements/rayons/motion). `AppShell` pose `data-theme="app"` par défaut ; les écrans de jeu opt-in `scene`/dark. Les écrans admin passent en cartes/hero avec header partagé.

**Tech Stack:** React 18 + React Router, Vite, CSS custom properties (pas de framework CSS), Vitest + Testing Library.

## Global Constraints

- **Toujours passer par les tokens de rôle** (`var(--brand)`, `var(--surface)`, `var(--ink)`…), jamais un hex en dur dans les composants/CSS. Les primitives `--sploot-*` ne sont référencées QUE dans `themes.css`.
- **RGAA** : texte ≥ 4.5:1, focus visible ≥ 3:1 contre le fond, cibles tactiles ≥ 44px, jamais la couleur seule (statut = icône + texte), `role="status"`/`role="alert"` conservés sur chargement/erreur/vide.
- **Le nom produit reste « Arena »** (le grief portait sur les couleurs).
- **Voix Sploot** dans l'accueil/états vides : un seul clin d'œil 🐾 par écran, sérieux d'abord (cf. `brand-kit/voice-and-tone.md`).
- **Commits fréquents**, un par task minimum. Vitest doit rester vert après chaque task.
- Lancer les tests web : `pnpm test` (ou le task runner du repo si différent — vérifier `apps/web/package.json`).

---

## Structure des fichiers

**Modifiés :**
- `apps/web/src/theme/themes.css` — gagne les rôles réponse/podium/focus, source unique.
- `apps/web/src/theme/themes.test.ts` — assertions étendues (rôles présents, pas de hex Kahoot).
- `apps/web/src/tokens.css` — perd toutes les primitives couleur, garde le non-couleur + base.
- `apps/web/src/AppShell.tsx` — thème `app` par défaut.
- `apps/web/src/routes.tsx` — wrappe HostLive/PlayerLive/Join en `scene`/dark.
- `apps/web/src/screens/Home.tsx` — refonte (hero, grille de cartes, header partagé).
- `apps/web/src/screens/HostEditor.tsx` — header partagé + polish.
- `apps/web/src/screens/Login.tsx`, `Signup.tsx` — carte rafraîchie.
- `apps/web/src/screens/SessionReport.tsx` — mise en page rapport.
- `apps/web/src/prototype.css` — classes admin (cartes, hero, header, focus token).

**Créés :**
- `apps/web/src/ui/AppHeader.tsx` — header/shell admin réutilisable.
- `apps/web/src/ui/AppHeader.test.tsx` — test du header.
- `apps/web/src/screens/Home.test.tsx` — flux création quiz + grille.
- `apps/web/src/theme/theme-mounting.test.tsx` — chaque route sous le bon `data-theme`.

---

## LOT A — Fondations tokens

### Task A1 : `themes.css` devient la source unique (réponse + podium + focus)

**Files:**
- Modify: `apps/web/src/theme/themes.css`
- Test: `apps/web/src/theme/themes.test.ts`

**Interfaces:**
- Produces: rôles `--ans-triangle|diamond|circle|square` (+ `-ink`), `--gold/--silver/--bronze`, `--warn`, `--focus`, définis sous `[data-theme='app']` ET `[data-theme='scene']`. Consommés tels quels par `ui.tsx` et `prototype.css` (noms identiques à l'actuel `tokens.css`).

- [ ] **Step 1 : Écrire le test garde-fou (échoue d'abord)**

Ajouter à `apps/web/src/theme/themes.test.ts` :

```ts
it('définit les rôles réponse, podium et focus (source unique)', () => {
  for (const role of [
    '--ans-triangle', '--ans-diamond', '--ans-circle', '--ans-square',
    '--gold', '--silver', '--bronze', '--focus',
  ]) {
    expect(themesCss).toContain(role)
  }
})

it('ne réintroduit pas la palette Kahoot (rose/violet)', () => {
  expect(themesCss.toLowerCase()).not.toContain('#ff3d7f')
  expect(themesCss.toLowerCase()).not.toContain('#7a5cff')
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web/src/theme/themes.test.ts`
Expected: FAIL (les rôles `--ans-*`/`--gold`/`--focus` ne sont pas encore dans `themes.css`).

- [ ] **Step 3 : Ajouter les rôles dans `themes.css`**

Dans **chaque** bloc (`[data-theme='app']` et `[data-theme='scene']`), après les rôles existants, ajouter (valeurs conservées telles quelles depuis l'ancien `tokens.css` — déjà vérifiées RGAA ≥4.5:1 ; on ne re-teinte PAS ici pour ne pas régresser le contraste, cf. spec §2 note ⚠️) :

```css
  /* Réponses — couleur + forme + label. Contraste ≥4.5:1 vérifié RGAA. */
  --ans-triangle: #c62828;  --ans-triangle-ink: #ffffff;
  --ans-diamond:  #1d5fb0;  --ans-diamond-ink:  #ffffff;
  --ans-circle:   #f2a900;  --ans-circle-ink:   #0e1230;
  --ans-square:   #0e7c68;  --ans-square-ink:   #ffffff;

  /* Podium — or/argent/bronze, RÉSERVÉ au classement, jamais accent. */
  --gold:   var(--sploot-warn);
  --silver: #c7ccdd;
  --bronze: #e0954f;

  /* Focus visible — token de rôle (remplace le gold codé en dur). */
  --focus: var(--sploot-petrol-soft);
```

Note : `--warn` est déjà mappé sur `--sploot-warn` dans les deux blocs — ne pas le dupliquer.

- [ ] **Step 4 : Lancer, vérifier le vert**

Run: `pnpm vitest run apps/web/src/theme/themes.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/theme/themes.css apps/web/src/theme/themes.test.ts
git commit -m "feat(theme): themes.css devient la source unique (réponse/podium/focus)"
```

---

### Task A2 : `AppShell` applique le thème `app` par défaut

**Files:**
- Modify: `apps/web/src/AppShell.tsx`
- Test: `apps/web/src/theme/theme-mounting.test.tsx` (créé ici)

**Interfaces:**
- Consumes: `ThemeProvider` de `./theme/ThemeProvider`.
- Produces: tout sous-arbre non wrappé rend sous `data-theme="app"` (rôles toujours définis — plus de fallback Kahoot).

- [ ] **Step 1 : Écrire le test (échoue d'abord)**

Créer `apps/web/src/theme/theme-mounting.test.tsx` :

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../AppShell'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

describe('AppShell', () => {
  it('pose data-theme="app" par défaut autour du contenu', () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>x</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-theme="app"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web/src/theme/theme-mounting.test.tsx`
Expected: FAIL (aucun `[data-theme="app"]` rendu par AppShell).

- [ ] **Step 3 : Envelopper le contenu d'AppShell**

Dans `apps/web/src/AppShell.tsx`, importer `ThemeProvider` et l'insérer sous `MotionProvider`, autour de `.prototype-root` :

```tsx
import { ThemeProvider } from './theme/ThemeProvider'
// …
      <MotionProvider>
        <ThemeProvider theme="app">
          <div className="prototype-root">
            <a className="ab-skip-link" href="#contenu-principal">
              Aller au contenu
            </a>
            <Outlet />
          </div>
        </ThemeProvider>
      </MotionProvider>
```

- [ ] **Step 4 : Lancer, vérifier le vert (et non-régression globale)**

Run: `pnpm test`
Expected: PASS (theme-mounting + suite existante).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/AppShell.tsx apps/web/src/theme/theme-mounting.test.tsx
git commit -m "feat(theme): AppShell applique le thème app par défaut"
```

---

### Task A3 : `tokens.css` perd ses primitives couleur (fin de la palette Kahoot)

**Files:**
- Modify: `apps/web/src/tokens.css`
- Test: `apps/web/src/theme/themes.test.ts` (ajout d'un garde-fou côté tokens.css)

**Interfaces:**
- Consumes: rôles fournis par `themes.css` (Task A1) via le `data-theme="app"` d'AppShell (Task A2).
- Produces: `tokens.css` = uniquement `--fs-*`, `--space-*`, `--radius-*`, `--transition-*`, reset/base, `prefers-reduced-motion`, `.visually-hidden`, focus-visible (couleur via `--focus`).

- [ ] **Step 1 : Écrire le garde-fou (échoue d'abord)**

Ajouter dans `apps/web/src/theme/themes.test.ts` :

```ts
import { readFileSync as _read } from 'node:fs'
import { fileURLToPath as _url } from 'node:url'

it("tokens.css ne définit plus de primitive couleur Kahoot", () => {
  const tokensCss = _read(_url(new URL('../tokens.css', import.meta.url)), 'utf-8').toLowerCase()
  expect(tokensCss).not.toContain('#ff3d7f') // rose Kahoot
  expect(tokensCss).not.toContain('#7a5cff') // violet Kahoot
  expect(tokensCss).not.toContain('#0e1230') // midnight bleuté
  expect(tokensCss).not.toContain('--brand:')
  expect(tokensCss).not.toContain('--stage:')
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web/src/theme/themes.test.ts`
Expected: FAIL (ces valeurs sont encore dans `tokens.css`).

- [ ] **Step 3 : Retirer les primitives couleur de `tokens.css`**

Dans `apps/web/src/tokens.css`, **supprimer** du bloc `:root` tous les groupes couleur : `--stage*`, `--surface*`, `--line`, `--ink*`, `--brand*`, `--gold/silver/bronze`, `--warn`, tous les `--ans-*`, `--success`, `--danger`, `--grad-brand`, et le bloc typographie `--font-*` (dupliqué par le brand-kit). **Conserver** : `--fs-*`, `--radius-*`, `--space-*`, `--transition-*`. Retirer aussi `color-scheme: dark;` (le thème le gère).

Puis, dans les styles de base, remplacer les usages devenus orphelins :
- `.prototype-root a { color: var(--brand); }` → inchangé (`--brand` vient maintenant du thème).
- `.prototype-root :focus-visible { outline: 3px solid var(--gold); }` → `outline: 3px solid var(--focus);`

(Tous les autres `var(--…)` de `tokens.css` résolvent désormais via `themes.css`.)

- [ ] **Step 4 : Lancer toute la suite + inspection visuelle**

Run: `pnpm test`
Expected: PASS.
Puis QA visuelle rapide : `pnpm --filter @splootlabs/web dev`, vérifier `/` (accueil) — fond chaud, accents ginger/petrol, plus aucun rose/violet.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/tokens.css apps/web/src/theme/themes.test.ts
git commit -m "refactor(theme): tokens.css perd ses couleurs Kahoot, rôles via themes.css"
```

---

## LOT B — Migration des écrans de jeu vers `scene`/dark

### Task B1 : HostLive, PlayerLive, Join en `scene`/dark via `routes.tsx`

**Files:**
- Modify: `apps/web/src/routes.tsx`
- Test: `apps/web/src/theme/theme-mounting.test.tsx`

**Interfaces:**
- Consumes: `ThemeProvider` (theme `scene`, scheme `dark`).
- Produces: `/host/:sessionId`, `/play`, `/join` rendus sous `data-theme="scene" data-scheme="dark"`. `Podium` hérite (rendu inline par HostLive/BigScreen). `BigScreen` garde son wrapper interne existant.

- [ ] **Step 1 : Écrire le test (échoue d'abord)**

Ajouter dans `apps/web/src/theme/theme-mounting.test.tsx` un cas qui monte `/join` via le vrai `router` n'est pas trivial (providers) ; tester plutôt le helper de wrapping. Ajouter à la place un test ciblé sur `routes.tsx` en montant l'élément de route `/join` :

```tsx
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
// Réutilise la config réelle : importe les routes et vérifie le wrapper scene.
// Si `router` est exporté, on remonte son arbre pour /join.
it('rend /join sous data-theme="scene" dark', async () => {
  const { router } = await import('../routes')
  const mem = createMemoryRouter(
    (router as any).routes, { initialEntries: ['/join'] },
  )
  const { container } = render(<RouterProvider router={mem} />)
  expect(container.querySelector('[data-theme="scene"][data-scheme="dark"]')).not.toBeNull()
})
```

Si le montage réel de `/join` échoue (dépendances socket), remplacer par un test unitaire d'un petit wrapper : extraire `SceneRoute` (ci-dessous) et tester `render(<SceneRoute><p>x</p></SceneRoute>)` → présence de `[data-theme="scene"][data-scheme="dark"]`.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web/src/theme/theme-mounting.test.tsx`
Expected: FAIL.

- [ ] **Step 3 : Wrapper les routes scene**

Dans `apps/web/src/routes.tsx`, importer `ThemeProvider` et définir un petit helper :

```tsx
import { ThemeProvider } from './theme/ThemeProvider'

function SceneRoute({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme="scene" scheme="dark">
      {children}
    </ThemeProvider>
  )
}
```

Puis envelopper les éléments concernés :
- `/host/:sessionId` : `<RequireAuth><SceneRoute><HostLive /></SceneRoute></RequireAuth>`
- `/play` : `element: <SceneRoute><PlayerLive /></SceneRoute>`
- `/join` : `element: <SceneRoute><Join /></SceneRoute>`

(Ne PAS toucher `/screen/:sessionId` : `BigScreen` s'auto-wrappe déjà.)

- [ ] **Step 4 : Lancer + QA visuelle**

Run: `pnpm test`
Expected: PASS.
QA : `/join` et le live host = fond dark chaud (`#17150F`), accents ginger/petrol, plus de midnight bleu.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/routes.tsx apps/web/src/theme/theme-mounting.test.tsx
git commit -m "feat(theme): écrans de jeu (host/play/join) en scene dark"
```

---

## LOT C — Refonte du dashboard admin (Home)

### Task C1 : Extraire le header/shell admin réutilisable (`AppHeader`)

**Files:**
- Create: `apps/web/src/ui/AppHeader.tsx`
- Create: `apps/web/src/ui/AppHeader.test.tsx`
- Modify: `apps/web/src/prototype.css` (aucune nouvelle règle requise — réutilise `.ab-shell__header`)

**Interfaces:**
- Produces: `AppHeader({ brandline?: string, actions?: ReactNode }): JSX` — rend `<header className="ab-shell__header">` avec `<Logo />`, une brandline optionnelle (`.host-brandline`) et une zone d'actions à droite.

- [ ] **Step 1 : Écrire le test (échoue d'abord)**

Créer `apps/web/src/ui/AppHeader.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppHeader } from './AppHeader'

describe('AppHeader', () => {
  it('rend le logo, la brandline et les actions', () => {
    render(<AppHeader brandline="quiz en direct" actions={<button>Se déconnecter</button>} />)
    expect(screen.getByText('Arena')).toBeInTheDocument()
    expect(screen.getByText(/quiz en direct/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web/src/ui/AppHeader.test.tsx`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter `AppHeader`**

Créer `apps/web/src/ui/AppHeader.tsx` :

```tsx
import type { ReactNode } from 'react'
import { Logo } from '../ui'

export function AppHeader({ brandline, actions }: { brandline?: string; actions?: ReactNode }) {
  return (
    <header className="ab-shell__header">
      <Logo />
      {brandline && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="host-brandline">{brandline}</p>
        </div>
      )}
      {actions && <div className="ab-shell__actions">{actions}</div>}
    </header>
  )
}
```

- [ ] **Step 4 : Lancer, vérifier le vert**

Run: `pnpm vitest run apps/web/src/ui/AppHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/ui/AppHeader.tsx apps/web/src/ui/AppHeader.test.tsx
git commit -m "feat(ui): AppHeader — header/shell admin réutilisable"
```

---

### Task C2 : Home — hero, CTA primaire, grille de cartes, états vides chaleureux

**Files:**
- Modify: `apps/web/src/screens/Home.tsx`
- Modify: `apps/web/src/prototype.css`
- Create: `apps/web/src/screens/Home.test.tsx`

**Interfaces:**
- Consumes: `AppHeader` (Task C1), rôles thème `app`.
- Produces: Home rend un hero + CTA « Nouveau quiz » primaire, une grille `.home-cards` de cartes quiz, une liste `.home-list` de parties. `data-theme="app"` (via AppShell — retirer le `<ThemeProvider>` redondant de Home).

- [ ] **Step 1 : Écrire le test (échoue d'abord)**

Créer `apps/web/src/screens/Home.test.tsx` (mocker les modules API) :

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../api/quizzes', () => ({
  listQuizzes: vi.fn(() => Promise.resolve([
    { id: 'q1', title: 'Culture G', description: null, questionCount: 8 },
  ])),
  createQuiz: vi.fn(),
}))
vi.mock('../api/sessions', () => ({ listSessions: vi.fn(() => Promise.resolve([])) }))
vi.mock('../api/auth', () => ({
  signOut: vi.fn(), useSession: () => ({ refresh: vi.fn() }),
}))

import { Home } from './Home'

describe('Home', () => {
  beforeEach(() => vi.clearAllMocks())

  it('affiche le CTA primaire et les quiz en cartes', async () => {
    render(<MemoryRouter><Home /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /nouveau quiz/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Culture G')).toBeInTheDocument())
    expect(screen.getByText(/8 questions/i)).toBeInTheDocument()
  })
})
```

Note : ce test suppose que `listQuizzes` renvoie `questionCount`. Vérifier le type `Quiz` dans `apps/web/src/api/quizzes.ts` — si `questionCount` n'existe pas, adapter le test à un champ existant (ex. n'afficher la ligne « N questions » que si `q.questionCount != null`) et ne pas asserter dessus.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web/src/screens/Home.test.tsx`
Expected: FAIL (pas encore de cartes / de bouton « Nouveau quiz » primaire au bon rôle).

- [ ] **Step 3 : Refondre le rendu de `Home.tsx`**

Dans `apps/web/src/screens/Home.tsx` :
1. Retirer le `<ThemeProvider theme="app">` englobant (fourni par AppShell) et son import.
2. Remplacer le `<header>` inline par `<AppHeader brandline="quiz en direct, open-source · chez vous ou dans le cloud" actions={<Button variant="ghost" …>Se déconnecter</Button>} />` (importer `AppHeader` depuis `../ui/AppHeader`).
3. Remplacer `<h1>Accueil</h1>` par un hero :

```tsx
<section className="home-hero">
  <div>
    <h1>Bonjour 👋</h1>
    <p className="home-hero__sub">Prêt à lancer une partie&nbsp;?</p>
  </div>
  <Button
    variant="primary"
    type="button"
    aria-expanded={creatingQuiz}
    onClick={() => { setCreatingQuiz((v) => !v); setNewQuizError(null) }}
  >
    {creatingQuiz ? 'Annuler' : '+ Nouveau quiz'}
  </Button>
</section>
```

Et retirer l'ancien bouton « Nouveau quiz » ghost du `.home-section__header` des quiz.

4. Remplacer la `<ul className="home-list">` des quiz par une grille de cartes :

```tsx
<ul className="home-cards">
  {quizzes.map((q) => (
    <li key={q.id}>
      <Link className="home-card" to={`/quizzes/${q.id}`}>
        <span className="home-card__title">{q.title}</span>
        {q.description && <span className="home-card__desc">{q.description}</span>}
        {q.questionCount != null && (
          <span className="home-card__meta">{q.questionCount} question{q.questionCount > 1 ? 's' : ''}</span>
        )}
        <span className="home-card__cta" aria-hidden="true">Éditer →</span>
      </Link>
    </li>
  ))}
</ul>
```

5. État vide des quiz — voix Sploot :

```tsx
<p className="ab-empty-state">
  Pas encore de quiz. On te fait de la place — crée-en un pour démarrer. 🐾
</p>
```

(Garder les parties récentes en `.home-list` avec le badge statut existant.)

- [ ] **Step 4 : Ajouter les styles dans `prototype.css`**

Ajouter (section Home) :

```css
.home-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.home-hero__sub { color: var(--ink-dim); margin-top: var(--space-1); }

.home-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-3);
}
.home-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 120px;
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  color: var(--ink);
  text-decoration: none;
}
.home-card:hover, .home-card:focus-visible {
  border-color: var(--brand);
  background: var(--surface-2);
}
.home-card__title { font-weight: 700; font-size: var(--fs-h3); }
.home-card__desc, .home-card__meta { color: var(--ink-dim); font-size: var(--fs-small); }
.home-card__cta { margin-top: auto; color: var(--brand); font-size: var(--fs-small); }
```

- [ ] **Step 5 : Lancer + QA**

Run: `pnpm vitest run apps/web/src/screens/Home.test.tsx`
Expected: PASS. QA visuelle : grille responsive, focus visible sur cartes, CTA primaire ginger.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/screens/Home.tsx apps/web/src/screens/Home.test.tsx apps/web/src/prototype.css
git commit -m "feat(admin): Home — hero, CTA primaire, grille de cartes, voix Sploot"
```

---

## LOT D — Autres écrans admin

### Task D1 : HostEditor — header partagé + polish

**Files:**
- Modify: `apps/web/src/screens/HostEditor.tsx`
- Modify: `apps/web/src/prototype.css` (si ajustements d'espacement nécessaires)

**Interfaces:**
- Consumes: `AppHeader` (Task C1).
- Produces: HostEditor utilise `AppHeader` pour son en-tête ; layout `host-layout` conservé, espacements/cartes soignés.

- [ ] **Step 1 : Repérer l'en-tête actuel**

Lire `apps/web/src/screens/HostEditor.tsx` autour du rendu principal (≈ ligne 912+, plus le rendu « normal » avec `.ab-shell__header` s'il existe). Identifier le bloc `<header>`/logo à remplacer.

- [ ] **Step 2 : Remplacer par `AppHeader`**

Importer `AppHeader` et remplacer le `<header className="ab-shell__header">…</header>` par :

```tsx
<AppHeader
  brandline="éditeur de quiz"
  actions={/* boutons existants : lancer la partie, se déconnecter… */}
/>
```

Conserver les actions existantes (démarrer session, retour, déconnexion) dans la prop `actions`.

- [ ] **Step 3 : Polish visuel**

Vérifier que les cartes de questions utilisent `--surface`/`--line`/`--radius-md`, que les boutons destructifs sont en `variant="danger"`, et que les états vides ont une microcopie Sploot (un seul 🐾). Ajouter/ajuster les règles `prototype.css` seulement si un écart visuel est constaté.

- [ ] **Step 4 : Lancer + QA**

Run: `pnpm test`
Expected: PASS. QA : éditeur en thème app chaud, header cohérent avec Home.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/screens/HostEditor.tsx apps/web/src/prototype.css
git commit -m "feat(admin): HostEditor — header partagé + polish"
```

---

### Task D2 : Login / Signup — carte chaleureuse cohérente

**Files:**
- Modify: `apps/web/src/screens/Login.tsx`, `apps/web/src/screens/Signup.tsx`
- Modify: `apps/web/src/prototype.css` (classe `.join-card` si retouches)

**Interfaces:**
- Produces: Login et Signup partagent la même mise en page « carte centrée » en thème app, liens croisés clairs, voix Sploot légère.

- [ ] **Step 1 : Lire les deux écrans**

Lire `Login.tsx` et `Signup.tsx` (≈ ligne 81/97+). Les deux rendent `<main className="join-screen"><Logo /><form className="join-card">`.

- [ ] **Step 2 : Harmoniser**

- Ajouter sous le `<Logo />` un titre `<h1>` explicite (`Se connecter` / `Créer un compte`) et un sous-titre chaleureux (une phrase, voix Sploot, sans emoji en rafale).
- Vérifier le lien croisé (Login ↔ Signup) présent et lisible (`.host-field__help` ou lien texte).
- S'assurer que les messages d'erreur restent `role="alert"` et que `aria-invalid`/`aria-describedby` sont posés sur les champs.

- [ ] **Step 3 : Styles**

Si besoin, dans `prototype.css`, donner à `.join-card` un fond `--surface`, bordure `--line`, `--radius-lg`, largeur `min(420px, 100%)`, centrée. Ne pas dupliquer si déjà présent.

- [ ] **Step 4 : Lancer + QA**

Run: `pnpm test`
Expected: PASS. QA : les deux écrans identiques en structure, thème app.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/screens/Login.tsx apps/web/src/screens/Signup.tsx apps/web/src/prototype.css
git commit -m "feat(admin): Login/Signup — carte chaleureuse cohérente"
```

---

### Task D3 : SessionReport — mise en page rapport

**Files:**
- Modify: `apps/web/src/screens/SessionReport.tsx`
- Modify: `apps/web/src/prototype.css` (classes `.report-*`)

**Interfaces:**
- Produces: SessionReport rend un résumé en cartes de stats + une liste/tableau scannable, badges statut icône+texte, thème app.

- [ ] **Step 1 : Lire l'écran + repérer les données**

Lire `SessionReport.tsx` (≈ ligne 122+) et les classes `.report-summary`/`.report-*` dans `prototype.css` (≈ ligne 1947+). Noter les champs disponibles (titre quiz, PIN, date, joueurs, scores).

- [ ] **Step 2 : Structurer le résumé en cartes de stats**

Présenter l'en-tête du rapport comme une rangée de « stat tiles » (nb joueurs, nb questions, date) : chaque tuile = valeur + label texte, fond `--surface`, `--radius-md`. Le classement/liste des joueurs reste scannable ; badges statut = icône + texte (jamais couleur seule).

- [ ] **Step 3 : Styles**

Ajouter/ajuster dans `prototype.css` :

```css
.report-stats { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-5); }
.report-stat {
  flex: 1 1 140px; padding: var(--space-4);
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md);
}
.report-stat__value { font-family: var(--font-display); font-size: var(--fs-h2); color: var(--ink-strong); }
.report-stat__label { color: var(--ink-dim); font-size: var(--fs-small); }
```

- [ ] **Step 4 : Lancer + QA**

Run: `pnpm test`
Expected: PASS. QA : rapport lisible, cartes de stats, thème app.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/screens/SessionReport.tsx apps/web/src/prototype.css
git commit -m "feat(admin): SessionReport — mise en page rapport (stat tiles)"
```

---

## LOT E — QA transversale & garde-fous

### Task E1 : Test de montage par route + revue de contraste

**Files:**
- Modify: `apps/web/src/theme/theme-mounting.test.tsx`

**Interfaces:**
- Consumes: rôles et wrappers des Lots A/B.
- Produces: garantie automatisée que chaque zone monte sous le bon `data-theme`.

- [ ] **Step 1 : Écrire les assertions restantes**

Compléter `theme-mounting.test.tsx` : un cas vérifiant qu'un écran admin monté sous `AppShell` hérite `data-theme="app"` (déjà couvert par A2 — étendre à un écran réel simple comme Login si montable sans réseau), et un cas `scene` pour `/host` ou `/play` si montable, sinon garder le test du helper `SceneRoute`.

- [ ] **Step 2 : Lancer**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3 : Revue de contraste manuelle (checklist)**

Avec `pnpm --filter @splootlabs/web dev`, en **app-clair, app-sombre et scene-dark**, vérifier au contrôleur de contraste du navigateur :
- texte principal `--ink` sur `--stage`/`--surface` ≥ 4.5:1 ;
- `--ink-dim` sur `--surface` ≥ 4.5:1 (sinon le réserver aux gros textes) ;
- focus `--focus` sur `--surface` et `--stage` ≥ 3:1 ;
- chaque `--ans-*` sur son `-ink` ≥ 4.5:1.
Consigner tout écart et corriger la primitive concernée dans `themes.css` (jamais dans les composants).

- [ ] **Step 4 : Commit (si corrections)**

```bash
git add apps/web/src/theme/theme-mounting.test.tsx apps/web/src/theme/themes.css
git commit -m "test(theme): montage par route + corrections contraste RGAA"
```

---

## Self-review (couverture spec)

- Spec §1 (architecture A1) → Tasks A1, A2, A3. ✅
- Spec §2 (palette anti-Kahoot, réponses/podium/focus dans themes.css) → A1, A3 (suppression Kahoot), garde-fous tests. ✅
- Spec §3 (refonte UX tous écrans admin + header partagé + voix Sploot + RGAA) → C1, C2, D1, D2, D3, E1. ✅
- Spec §4 (migration écrans de jeu) → B1 (+ AppShell A2 pour les écrans app ; Podium hérite ; BigScreen inchangé). ✅
- Spec §5 (tests) → tests dans chaque task + E1. ✅

**Note de granularité honnête** : le CSS/visuel se prête mal au TDD strict ; les tasks combinent tests là où c'est utile (tokens, montage thème, flux création quiz, header) et **QA visuelle explicite** là où un test unitaire ne capte pas le rendu. Les valeurs `--ans-*` sont **relocalisées telles quelles** (contraste déjà vérifié) plutôt que re-teintées, pour ne pas régresser le RGAA — une harmonisation de teinte reste possible en suivi si re-vérifiée ≥4.5:1.
