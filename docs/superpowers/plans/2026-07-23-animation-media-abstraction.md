# Abstraction animations / son / vidéo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter `apps/web` d'une couche d'abstraction (registre de cues au-dessus de primitives maison) permettant d'ajouter facilement animations, sons et vidéos partout, avec un thème tokenisé sur le brand-kit Sploot Labs.

**Architecture:** Quatre couches étanches — fondations (tokens + reduced-motion), primitives (Reveal/Stagger/CountUp/AnimatedBar/Confetti/SoundManager/MediaOverlay), cues (registre `moment → effets`), écrans (émettent des cues). Framer Motion, le canvas de confetti et Web Audio sont **cachés** derrière la couche `motion/` ; un test d'architecture interdit leur import ailleurs.

**Tech Stack:** React 18, Vite, TypeScript (ESM/NodeNext), Vitest, `framer-motion` (orchestration de phase, caché), Web Audio + canvas natifs, `@testing-library/react` + `jsdom` (tests composants).

Spec de référence : `docs/superpowers/specs/2026-07-23-animation-media-abstraction-design.md`.

## Global Constraints

- **Aucun écran n'importe `framer-motion`, le canvas de confetti ou Web Audio** — uniquement `apps/web/src/motion/`. Vérifié par un test d'architecture (Task 12).
- **Accessibilité préservée** : `prefers-reduced-motion` coupe le visuel (garde le son par défaut) ; toute animation est `aria-hidden` et jamais le seul porteur d'info ; le focus par phase reste piloté par les `headingRef` existants (RGAA 2.4.3) ; le son est opt-in, jamais avant un geste utilisateur.
- **Tokens uniquement** : aucune couleur/durée en dur dans les composants — toujours via les rôles CSS (`--brand`, `--stage`, `--dur-base`…).
- **Rien ne casse le jour 1** : `tokens.css` et `prototype.css` restent en place ; un cue non enregistré est un no-op silencieux (jamais une erreur).
- **Style de test** : Vitest. Tests de logique en `.test.ts` (environnement `node`). Tests de composants en `.test.tsx` avec le docblock `// @vitest-environment jsdom` en tête de fichier.
- **Modules ESM/NodeNext** : imports relatifs avec extension `.js` dans le code applicatif existant (cf. `client.test.ts` → `import … from './client.js'`). Suivre ce style.
- **Langue** : commentaires et libellés UI en français, cohérents avec l'existant.

---

## File Structure

**Créés — `apps/web/src/theme/`**
- `tokens.motion.css` — durées, easings, distances de mouvement.
- `themes.css` — mappe les primitives brand-kit vers les rôles produit par `[data-theme="app"|"scene"]`.
- `ThemeProvider.tsx` — applique `data-theme` / `data-scheme`, expose un contexte.

**Créés — `apps/web/src/motion/`**
- `cues.ts` — type `Cue` (union ouverte), type `CueContext`.
- `registry.ts` — table `cue → CueEffect` + fonctions d'effet (`sweepIn`, `pulseGreen`…).
- `MotionProvider.tsx` — moteur : lit reduced-motion, expose `cue()`, route vers registre/son/média.
- `useCue.ts` — hook `useCue()` + composant `<Cue on when>`.
- `animatedValue.ts` — helper d'interpolation motion-safe (contrat partagé).
- `primitives/Reveal.tsx`, `Stagger.tsx`, `CountUp.tsx`, `AnimatedBar.tsx`, `Confetti.tsx`, `MediaOverlay.tsx`, `PhaseTransition.tsx`.
- `sound/SoundManager.ts`, `sound/sounds.ts`, `sound/useSound.ts`.
- `index.ts` — surface publique (ré-exporte ce que les écrans importent).
- `architecture.test.ts` — garde : pas d'import `framer-motion` hors de `motion/`.

**Modifiés**
- `vitest.config.ts` — inclure `.tsx`, ajouter `setupFiles`.
- `apps/web/package.json` — devDeps de test + `framer-motion`.
- `apps/web/src/AppShell.tsx` — monte `ThemeProvider` + `MotionProvider`.
- `apps/web/src/screens/BigScreen.tsx` — thème `scene`, cues, `AnimatedBar`/`CountUp`, `PhaseTransition`.
- `apps/web/src/screens/PlayerLive.tsx` — cues feedback réponse + `timer.urgent`.
- `apps/web/src/screens/Home.tsx` — thème `app`, `Reveal`/`Stagger`.

---

## Task 1: Infrastructure de test (jsdom + RTL) et dépendances

**Files:**
- Modify: `apps/web/package.json`
- Modify: `vitest.config.ts`
- Create: `apps/web/vitest.setup.ts`
- Test: `apps/web/src/motion/smoke.test.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: environnement jsdom disponible via docblock `// @vitest-environment jsdom` ; `window.matchMedia` mockable ; `framer-motion` installé.

- [ ] **Step 1: Ajouter les dépendances**

Éditer `apps/web/package.json`. Ajouter à `dependencies` :
```json
"framer-motion": "^11.11.0"
```
Ajouter à `devDependencies` :
```json
"@testing-library/jest-dom": "^6.6.0",
"@testing-library/react": "^16.0.0",
"jsdom": "^25.0.0"
```

- [ ] **Step 2: Installer**

Run: `pnpm install`
Expected: installation OK, `framer-motion` et les 3 devDeps résolus.

- [ ] **Step 3: Élargir la config Vitest aux `.tsx` + setup**

Remplacer le contenu de `vitest.config.ts` par :
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./apps/web/vitest.setup.ts'],
  },
})
```

- [ ] **Step 4: Écrire le setup (mock matchMedia, garde node)**

Créer `apps/web/vitest.setup.ts` :
```ts
// Setup partagé. Chargé pour TOUS les tests (node et jsdom) : les stubs
// spécifiques au DOM sont gardés par `typeof window` pour ne rien casser en node.
import { afterEach } from 'vitest'

if (typeof window !== 'undefined') {
  // jsdom n'implémente pas matchMedia ; par défaut on répond « pas de
  // préférence reduced-motion » (les tests reduced-motion la surchargent).
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  }
}

afterEach(() => {
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-theme')
})
```

- [ ] **Step 5: Écrire un test de fumée jsdom**

Créer `apps/web/src/motion/smoke.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('infra de test jsdom', () => {
  it('rend un composant React dans le DOM', () => {
    render(<p>bonjour</p>)
    expect(screen.getByText('bonjour')).toBeDefined()
  })
})
```

- [ ] **Step 6: Lancer et vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/smoke.test.tsx`
Expected: 1 test PASS.

- [ ] **Step 7: Vérifier la non-régression globale**

Run: `pnpm test`
Expected: toute la suite existante reste verte (aucun test cassé par le changement d'`include`/`setupFiles`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml vitest.config.ts apps/web/vitest.setup.ts apps/web/src/motion/smoke.test.tsx
git commit -m "test(web): infra jsdom + RTL et dépendance framer-motion"
```

---

## Task 2: Tokens de motion, thèmes et ThemeProvider

**Files:**
- Create: `apps/web/src/theme/tokens.motion.css`
- Create: `apps/web/src/theme/themes.css`
- Create: `apps/web/src/theme/ThemeProvider.tsx`
- Test: `apps/web/src/theme/ThemeProvider.test.tsx`

**Interfaces:**
- Consumes: primitives brand-kit (`brand-kit/design-tokens.css`, déjà importées globalement — voir Step 4).
- Produces :
  - `ThemeProvider({ theme, scheme?, children }): JSX.Element` où `theme: 'app' | 'scene'`, `scheme?: 'light' | 'dark'`.
  - `useTheme(): { theme: ProductTheme }`.
  - Rôles CSS mappés : `--stage --surface --surface-2 --ink --ink-dim --line --brand --brand-2 --success --warn --danger`.

- [ ] **Step 1: Écrire le test (attributs posés sur l'élément racine du provider)**

Créer `apps/web/src/theme/ThemeProvider.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from './ThemeProvider.js'

describe('ThemeProvider', () => {
  it('pose data-theme sur son wrapper', () => {
    const { container } = render(<ThemeProvider theme="scene"><span>x</span></ThemeProvider>)
    const root = container.querySelector('[data-theme]')
    expect(root?.getAttribute('data-theme')).toBe('scene')
  })

  it('force data-scheme quand fourni (grand écran sombre)', () => {
    const { container } = render(
      <ThemeProvider theme="scene" scheme="dark"><span>x</span></ThemeProvider>,
    )
    const root = container.querySelector('[data-theme]')
    expect(root?.getAttribute('data-scheme')).toBe('dark')
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/theme/ThemeProvider.test.tsx`
Expected: FAIL (module `./ThemeProvider.js` introuvable).

- [ ] **Step 3: Écrire les tokens de motion**

Créer `apps/web/src/theme/tokens.motion.css` :
```css
/* Tokens de mouvement — toutes les animations parlent le même langage. */
:root {
  --dur-instant: 90ms;
  --dur-quick: 160ms;
  --dur-base: 240ms;
  --dur-slow: 420ms;
  --dur-scene: 700ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --lift-1: 2px;
  --lift-2: 8px;
  --rise: 16px;
}
```

- [ ] **Step 4: Écrire le mapping de thèmes**

Créer `apps/web/src/theme/themes.css`. Il mappe les primitives brand-kit (`--sploot-*`) vers les rôles produit consommés par `prototype.css`. Les sélecteurs `:root[data-theme=…]` gagnent en spécificité sur le `:root` de `tokens.css`, donc l'ordre d'import importe peu.
```css
/* Rôles produit dérivés des primitives brand-kit, par thème.
   Le brand-kit fournit les primitives --sploot-* (light/dark via data-scheme). */

:root[data-theme='app'] {
  --stage: var(--sploot-bg);
  --stage-2: var(--sploot-surface-2);
  --surface: var(--sploot-surface);
  --surface-2: var(--sploot-surface-2);
  --line: var(--sploot-line);
  --ink: var(--sploot-text);
  --ink-dim: var(--sploot-muted);
  --ink-strong: var(--sploot-text);
  --brand: var(--sploot-ginger);
  --brand-2: var(--sploot-petrol);
  --success: var(--sploot-ok);
  --warn: var(--sploot-warn);
  --danger: var(--sploot-bad);
  --grad-brand: linear-gradient(135deg, var(--sploot-ginger), var(--sploot-petrol));
  color-scheme: light dark;
}

/* Grand écran : sombre assumé (le sous-arbre force data-scheme="dark"). */
:root[data-theme='scene'] {
  --stage: var(--sploot-bg);
  --stage-2: var(--sploot-surface-2);
  --surface: var(--sploot-surface);
  --surface-2: var(--sploot-surface-2);
  --line: var(--sploot-line);
  --ink: var(--sploot-text);
  --ink-dim: var(--sploot-muted);
  --ink-strong: var(--sploot-text);
  --brand: var(--sploot-ginger);
  --brand-2: var(--sploot-petrol-soft);
  --success: var(--sploot-ok);
  --warn: var(--sploot-warn);
  --danger: var(--sploot-bad);
  --grad-brand: linear-gradient(135deg, var(--sploot-ginger), var(--sploot-petrol-soft));
  color-scheme: dark;
}

/* data-scheme force la palette brand-kit indépendamment de prefers-color-scheme.
   Le brand-kit expose déjà :root[data-theme="dark"|"light"] ; on réexpose les
   mêmes valeurs sous notre attribut dédié data-scheme pour lever l'ambiguïté
   avec le thème PRODUIT (data-theme). */
:root[data-scheme='dark'] {
  --sploot-ginger: #e88a3c;
  --sploot-ginger-deep: #c86e24;
  --sploot-petrol: #4fa3a0;
  --sploot-petrol-soft: #6fbdb8;
  --sploot-bg: #17150f;
  --sploot-surface: #201d15;
  --sploot-surface-2: #2a261c;
  --sploot-text: #ede7da;
  --sploot-muted: #a29a8b;
  --sploot-line: #34301f;
  --sploot-ok: #5fa778;
  --sploot-warn: #e0a64b;
  --sploot-bad: #d96a52;
}
:root[data-scheme='light'] {
  --sploot-ginger: #d9772b;
  --sploot-ginger-deep: #b85f1e;
  --sploot-petrol: #1e5f60;
  --sploot-petrol-soft: #2f7c7b;
  --sploot-bg: #ece7dd;
  --sploot-surface: #f5f1e9;
  --sploot-surface-2: #e4decf;
  --sploot-text: #241f18;
  --sploot-muted: #6e665a;
  --sploot-line: #d8d0c1;
  --sploot-ok: #3f7d57;
  --sploot-warn: #c98a2e;
  --sploot-bad: #c0503a;
}
```

- [ ] **Step 5: Écrire le ThemeProvider**

Créer `apps/web/src/theme/ThemeProvider.tsx` :
```tsx
import { createContext, useContext, type ReactNode } from 'react'
import './tokens.motion.css'
import './themes.css'

export type ProductTheme = 'app' | 'scene'
export type ColorScheme = 'light' | 'dark'

interface ThemeContextValue {
  theme: ProductTheme
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'app' })

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/**
 * Applique le thème PRODUIT (data-theme) et, optionnellement, un schéma de
 * couleur forcé (data-scheme) sur un wrapper local — pas sur <html> — pour que
 * plusieurs thèmes puissent coexister par sous-arbre de route (ex. le grand
 * écran en `scene`/`dark` pendant que le reste est en `app`).
 */
export function ThemeProvider({
  theme,
  scheme,
  children,
}: {
  theme: ProductTheme
  scheme?: ColorScheme
  children: ReactNode
}) {
  return (
    <ThemeContext.Provider value={{ theme }}>
      <div data-theme={theme} {...(scheme ? { 'data-scheme': scheme } : {})}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}
```

- [ ] **Step 6: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/theme/ThemeProvider.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/theme/
git commit -m "feat(web): tokens de motion, mapping de thèmes brand-kit et ThemeProvider"
```

---

## Task 3: Moteur de cues (MotionProvider + useCue + registre vide)

**Files:**
- Create: `apps/web/src/motion/cues.ts`
- Create: `apps/web/src/motion/registry.ts`
- Create: `apps/web/src/motion/MotionProvider.tsx`
- Create: `apps/web/src/motion/useCue.ts`
- Test: `apps/web/src/motion/MotionProvider.test.tsx`

**Interfaces:**
- Consumes: rien (le registre démarre quasi vide).
- Produces :
  - `type Cue` (voir Step 3), `interface CueContext { el?: HTMLElement; [k: string]: unknown }`.
  - `interface CueEffect { animation?: (ctx: CueContext) => void; sound?: SoundId; media?: { src: string; mode: 'overlay' | 'background' }; reducedMotion?: 'skip' | 'crossfade' }`.
  - `const registry: Partial<Record<string, CueEffect>>`.
  - `MotionProvider({ children }): JSX.Element`.
  - `useCue(): (cue: Cue, ctx?: CueContext) => void`.
  - `useReducedMotion(): boolean`.
  - `<Cue on={Cue} when?={boolean} />`.

- [ ] **Step 1: Écrire le test (cue inconnu = no-op, reduced-motion coupe l'animation)**

Créer `apps/web/src/motion/MotionProvider.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MotionProvider } from './MotionProvider.js'
import { useCue } from './useCue.js'
import { registry } from './registry.js'

function Emit({ cue }: { cue: string }) {
  const fire = useCue()
  useEffect(() => {
    fire(cue as never)
  }, [cue, fire])
  return null
}

describe('moteur de cues', () => {
  it("un cue non enregistré est un no-op (ne lève pas)", () => {
    expect(() =>
      render(
        <MotionProvider>
          <Emit cue="inconnu.total" />
        </MotionProvider>,
      ),
    ).not.toThrow()
  })

  it("joue l'animation d'un cue enregistré", () => {
    const spy = vi.fn()
    registry['test.ping'] = { animation: spy }
    render(
      <MotionProvider>
        <Emit cue="test.ping" />
      </MotionProvider>,
    )
    expect(spy).toHaveBeenCalledOnce()
    delete registry['test.ping']
  })

  it("saute l'animation en reduced-motion mais laisse le cue passer", () => {
    window.matchMedia = ((q: string) =>
      ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    const anim = vi.fn()
    registry['test.rm'] = { animation: anim, reducedMotion: 'skip' }
    render(
      <MotionProvider>
        <Emit cue="test.rm" />
      </MotionProvider>,
    )
    expect(anim).not.toHaveBeenCalled()
    delete registry['test.rm']
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/motion/MotionProvider.test.tsx`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Écrire la taxonomie des cues**

Créer `apps/web/src/motion/cues.ts` :
```ts
/** Moment sémantique nommé. Nommage : <domaine>.<moment>[:<variante>]. */
export type Cue =
  | `phase.enter:${'lobby' | 'question' | 'reveal' | 'scoreboard' | 'podium'}`
  | 'answer.submit'
  | 'answer.correct'
  | 'answer.incorrect'
  | 'score.increment'
  | 'player.join'
  | 'podium.celebrate'
  | 'timer.urgent'
  // Union ouverte : un cue non répertorié reste typable et devient un no-op au
  // runtime (voir MotionProvider). Permet de semer des cue() avant de concevoir
  // leur effet.
  | (string & {})

/** Contexte optionnel passé à l'effet (ancre DOM, données du moment). */
export interface CueContext {
  el?: HTMLElement
  [k: string]: unknown
}
```

- [ ] **Step 4: Écrire le registre (vide au départ)**

Créer `apps/web/src/motion/registry.ts` :
```ts
import type { CueContext } from './cues.js'
import type { SoundId } from './sound/sounds.js'

export interface CueEffect {
  /** Animation visuelle (jouée par le moteur). Ignorée en reduced-motion. */
  animation?: (ctx: CueContext) => void
  /** Clé du catalogue de sons (indirection). */
  sound?: SoundId
  /** Overlay vidéo optionnel. */
  media?: { src: string; mode: 'overlay' | 'background' }
  /** Comportement visuel en reduced-motion. Défaut : 'skip' (le son passe). */
  reducedMotion?: 'skip' | 'crossfade'
}

/**
 * LA table cue → effets. Ajouter une animation/son/vidéo « partout » = éditer
 * CE fichier, jamais un écran. Démarre quasi vide (rempli surface par surface,
 * Tasks 9+).
 */
export const registry: Partial<Record<string, CueEffect>> = {}
```

- [ ] **Step 5: Écrire le MotionProvider + useReducedMotion**

Créer `apps/web/src/motion/MotionProvider.tsx` :
```tsx
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Cue, CueContext } from './cues.js'
import { registry } from './registry.js'
import { SoundManager } from './sound/SoundManager.js'

interface MotionContextValue {
  reducedMotion: boolean
  fire: (cue: Cue, ctx?: CueContext) => void
  sound: SoundManager
}

const MotionContext = createContext<MotionContextValue | null>(null)

export function useMotion(): MotionContextValue {
  const ctx = useContext(MotionContext)
  if (!ctx) throw new Error('useMotion doit être utilisé dans <MotionProvider>')
  return ctx
}

export function useReducedMotion(): boolean {
  return useMotion().reducedMotion
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion)
  const soundRef = useRef<SoundManager | null>(null)
  if (!soundRef.current) soundRef.current = new SoundManager()

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const value = useMemo<MotionContextValue>(() => {
    const sound = soundRef.current!
    return {
      reducedMotion,
      sound,
      fire(cue, ctx) {
        const effect = registry[cue]
        if (!effect) return // no-op : cue non enregistré
        if (effect.animation && !reducedMotion) effect.animation(ctx ?? {})
        if (effect.sound) sound.play(effect.sound)
        // media : câblé au MediaOverlay en Task 8 (ici : rien à faire côté moteur).
      },
    }
  }, [reducedMotion])

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
}
```

- [ ] **Step 6: Écrire useCue + le composant <Cue>**

Créer `apps/web/src/motion/useCue.ts` :
```tsx
import { useEffect } from 'react'
import type { Cue, CueContext } from './cues.js'
import { useMotion } from './MotionProvider.js'

/** Retourne la fonction d'émission de cue. */
export function useCue(): (cue: Cue, ctx?: CueContext) => void {
  return useMotion().fire
}

/** Forme déclarative : émet `on` quand `when` passe à vrai (ou au montage si non fourni). */
export function Cue({ on, when = true }: { on: Cue; when?: boolean }) {
  const fire = useCue()
  useEffect(() => {
    if (when) fire(on)
  }, [on, when, fire])
  return null
}
```

- [ ] **Step 7: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/MotionProvider.test.tsx`
Expected: 3 tests PASS. (Dépend de `SoundManager`/`sounds` créés en Task 4 — si exécuté strictement dans l'ordre, faire d'abord Task 4. Voir note ci-dessous.)

> **Note d'ordonnancement** : `MotionProvider` importe `SoundManager` (Task 4) et `registry` importe le type `SoundId` (Task 4). Exécuter **Task 4 avant de lancer le test de Task 3**, ou créer d'abord des stubs. Le plan liste Task 4 juste après ; l'implémenteur peut créer `sound/sounds.ts` et `sound/SoundManager.ts` (Task 4 Steps 3-5) avant le Step 7 ci-dessus.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/motion/cues.ts apps/web/src/motion/registry.ts apps/web/src/motion/MotionProvider.tsx apps/web/src/motion/useCue.ts apps/web/src/motion/MotionProvider.test.tsx
git commit -m "feat(web): moteur de cues (MotionProvider, useCue, registre vide)"
```

---

## Task 4: SoundManager (Web Audio, opt-in)

**Files:**
- Create: `apps/web/src/motion/sound/sounds.ts`
- Create: `apps/web/src/motion/sound/SoundManager.ts`
- Create: `apps/web/src/motion/sound/useSound.ts`
- Test: `apps/web/src/motion/sound/SoundManager.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces :
  - `const sounds: Record<SoundId, string>` ; `type SoundId = 'ding' | 'buzz' | 'tick' | 'fanfare' | 'lobby'`.
  - `class SoundManager { unlock(): void; play(id: SoundId): void; loop(id: SoundId, opts?: { fade?: number }): void; stop(id: SoundId): void; setMuted(m: boolean): void; get muted(): boolean }`.
  - `useSound(): SoundManager`.

- [ ] **Step 1: Écrire le test (rien avant unlock, muted coupe, catalogue résolu)**

Créer `apps/web/src/motion/sound/SoundManager.test.ts` :
```ts
import { describe, expect, it, vi } from 'vitest'
import { SoundManager } from './SoundManager.js'
import { sounds } from './sounds.js'

describe('SoundManager', () => {
  it('ne joue rien avant unlock()', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.play('ding')
    expect(play).not.toHaveBeenCalled()
  })

  it('joue après unlock()', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.unlock()
    sm.play('ding')
    expect(play).toHaveBeenCalledWith('ding')
  })

  it('muted coupe la lecture même après unlock', () => {
    const play = vi.fn()
    const sm = new SoundManager({ playFn: play })
    sm.unlock()
    sm.setMuted(true)
    sm.play('ding')
    expect(play).not.toHaveBeenCalled()
    expect(sm.muted).toBe(true)
  })

  it('le catalogue résout chaque clé vers une URL', () => {
    expect(sounds.ding).toMatch(/\.mp3$/)
    expect(Object.keys(sounds)).toContain('fanfare')
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/motion/sound/SoundManager.test.ts`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Écrire le catalogue**

Créer `apps/web/src/motion/sound/sounds.ts` :
```ts
/** Catalogue de sons : les cues référencent une clé, jamais une URL. Changer un
 * son = éditer ce fichier. Les fichiers vivent dans apps/web/public/sfx/. */
export const sounds = {
  ding: '/sfx/ding.mp3',
  buzz: '/sfx/buzz.mp3',
  tick: '/sfx/tick.mp3',
  fanfare: '/sfx/fanfare.mp3',
  lobby: '/sfx/lobby-loop.mp3',
} as const

export type SoundId = keyof typeof sounds
```

- [ ] **Step 4: Écrire le SoundManager**

Créer `apps/web/src/motion/sound/SoundManager.ts` :
```ts
import { sounds, type SoundId } from './sounds.js'

const MUTE_STORAGE_KEY = 'arena.sound.muted'

interface SoundManagerOptions {
  /** Injection pour les tests : remplace la vraie lecture <audio>. */
  playFn?: (id: SoundId, opts?: { loop?: boolean }) => void
}

/**
 * Gestion du son opt-in. L'autoplay policy interdit le son avant interaction :
 * rien n'est émis avant `unlock()` (appelé au 1er geste utilisateur). Muet
 * persistant via localStorage.
 */
export class SoundManager {
  private unlocked = false
  private _muted: boolean
  private readonly playFn: (id: SoundId, opts?: { loop?: boolean }) => void
  private readonly elements = new Map<SoundId, HTMLAudioElement>()

  constructor(opts: SoundManagerOptions = {}) {
    this._muted = readStoredMuted()
    this.playFn = opts.playFn ?? ((id, o) => this.playViaAudio(id, o))
  }

  get muted(): boolean {
    return this._muted
  }

  unlock(): void {
    this.unlocked = true
  }

  setMuted(m: boolean): void {
    this._muted = m
    if (typeof localStorage !== 'undefined') localStorage.setItem(MUTE_STORAGE_KEY, m ? '1' : '0')
  }

  play(id: SoundId): void {
    if (!this.unlocked || this._muted) return
    this.playFn(id)
  }

  loop(id: SoundId, _opts: { fade?: number } = {}): void {
    if (!this.unlocked || this._muted) return
    this.playFn(id, { loop: true })
  }

  stop(id: SoundId): void {
    const el = this.elements.get(id)
    if (el) {
      el.pause()
      el.currentTime = 0
    }
  }

  private playViaAudio(id: SoundId, opts: { loop?: boolean } = {}): void {
    if (typeof Audio === 'undefined') return
    let el = this.elements.get(id)
    if (!el) {
      el = new Audio(sounds[id])
      this.elements.set(id, el)
    }
    el.loop = opts.loop ?? false
    el.currentTime = 0
    void el.play().catch(() => {
      /* geste utilisateur requis / fichier absent : silence, jamais de crash */
    })
  }
}

function readStoredMuted(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(MUTE_STORAGE_KEY) === '1'
}
```

- [ ] **Step 5: Écrire useSound**

Créer `apps/web/src/motion/sound/useSound.ts` :
```ts
import { useMotion } from '../MotionProvider.js'
import type { SoundManager } from './SoundManager.js'

/** Accès au SoundManager partagé du MotionProvider. */
export function useSound(): SoundManager {
  return useMotion().sound
}
```

- [ ] **Step 6: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/sound/SoundManager.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/motion/sound/
git commit -m "feat(web): SoundManager Web Audio opt-in + catalogue de sons"
```

---

## Task 5: Helper d'interpolation `animatedValue` (contrat partagé)

**Files:**
- Create: `apps/web/src/motion/animatedValue.ts`
- Test: `apps/web/src/motion/animatedValue.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces : `function interpolate(from: number, to: number, t: number): number` (t clampé 0..1) ; `function easeOut(t: number): number`.

- [ ] **Step 1: Écrire le test**

Créer `apps/web/src/motion/animatedValue.test.ts` :
```ts
import { describe, expect, it } from 'vitest'
import { easeOut, interpolate } from './animatedValue.js'

describe('animatedValue', () => {
  it('interpolate renvoie les bornes à t=0 et t=1', () => {
    expect(interpolate(10, 20, 0)).toBe(10)
    expect(interpolate(10, 20, 1)).toBe(20)
  })

  it('interpolate clampe t hors [0,1]', () => {
    expect(interpolate(0, 100, -0.5)).toBe(0)
    expect(interpolate(0, 100, 2)).toBe(100)
  })

  it('interpolate est linéaire au milieu', () => {
    expect(interpolate(0, 100, 0.5)).toBe(50)
  })

  it('easeOut est monotone et borné', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5) // décélération : dépasse la linéaire
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/motion/animatedValue.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Écrire le helper**

Créer `apps/web/src/motion/animatedValue.ts` :
```ts
/** Contrat d'interpolation partagé par CountUp, AnimatedBar, TimerRing. */

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** Interpolation linéaire, t clampé dans [0,1]. */
export function interpolate(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t)
}

/** Décélération (ease-out cubique) : rapide au début, lent à la fin. */
export function easeOut(t: number): number {
  const c = clamp01(t)
  return 1 - Math.pow(1 - c, 3)
}
```

- [ ] **Step 4: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/animatedValue.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/motion/animatedValue.ts apps/web/src/motion/animatedValue.test.ts
git commit -m "feat(web): helper d'interpolation animatedValue (contrat partagé)"
```

---

## Task 6: Primitives `<CountUp>` et `<Reveal>`

**Files:**
- Create: `apps/web/src/motion/primitives/CountUp.tsx`
- Create: `apps/web/src/motion/primitives/Reveal.tsx`
- Test: `apps/web/src/motion/primitives/CountUp.test.tsx`
- Test: `apps/web/src/motion/primitives/Reveal.test.tsx`

**Interfaces:**
- Consumes: `useReducedMotion` (Task 3), `interpolate`/`easeOut` (Task 5).
- Produces :
  - `<CountUp value: number, format?: (n: number) => string, durationMs?: number />`.
  - `<Reveal as?: keyof JSX.IntrinsicElements, from?: 'up' | 'down' | 'none', delay?: number, children >`.

- [ ] **Step 1: Écrire les tests (reduced-motion → valeur finale immédiate / rendu immédiat)**

Créer `apps/web/src/motion/primitives/CountUp.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { CountUp } from './CountUp.js'

function withRM(matches: boolean) {
  window.matchMedia = ((q: string) =>
    ({ matches, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
}

describe('CountUp', () => {
  it('affiche directement la valeur finale en reduced-motion', () => {
    withRM(true)
    render(
      <MotionProvider>
        <CountUp value={1250} format={(n) => `${n} pts`} />
      </MotionProvider>,
    )
    expect(screen.getByText('1250 pts')).toBeDefined()
  })
})
```

Créer `apps/web/src/motion/primitives/Reveal.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { Reveal } from './Reveal.js'

describe('Reveal', () => {
  it('rend son contenu immédiatement (présent dans le DOM)', () => {
    window.matchMedia = ((q: string) =>
      ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    render(
      <MotionProvider>
        <Reveal>coucou</Reveal>
      </MotionProvider>,
    )
    expect(screen.getByText('coucou')).toBeDefined()
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/motion/primitives/CountUp.test.tsx apps/web/src/motion/primitives/Reveal.test.tsx`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Écrire CountUp**

Créer `apps/web/src/motion/primitives/CountUp.tsx` :
```tsx
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../MotionProvider.js'
import { easeOut, interpolate } from '../animatedValue.js'

/** Nombre qui s'incrémente de l'ancienne valeur à `value`. En reduced-motion,
 * affiche directement la valeur finale. tabular-nums pour éviter le jitter. */
export function CountUp({
  value,
  format = (n) => String(n),
  durationMs = 600,
}: {
  value: number
  format?: (n: number) => string
  durationMs?: number
}) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      fromRef.current = value
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    function frame(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      setDisplay(Math.round(interpolate(from, value, easeOut(t))))
      if (t < 1) raf = requestAnimationFrame(frame)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [value, durationMs, reduced])

  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(display)}</span>
}
```

- [ ] **Step 4: Écrire Reveal**

Créer `apps/web/src/motion/primitives/Reveal.tsx` :
```tsx
import { createElement, type ReactNode } from 'react'
import { useReducedMotion } from '../MotionProvider.js'

/** Apparition (fade + rise). Le contenu est TOUJOURS dans le DOM (l'animation
 * n'est qu'un habillage) ; en reduced-motion, aucun transform ni délai. */
export function Reveal({
  as = 'div',
  from = 'up',
  delay = 0,
  children,
}: {
  as?: keyof JSX.IntrinsicElements
  from?: 'up' | 'down' | 'none'
  delay?: number
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const offset = from === 'up' ? 'var(--rise)' : from === 'down' ? 'calc(-1 * var(--rise))' : '0'
  const style = reduced
    ? undefined
    : {
        animation: `ab-reveal var(--dur-base) var(--ease-out) ${delay}ms both`,
        ['--reveal-from' as string]: offset,
      }
  return createElement(as, { style }, children)
}
```

Ajouter le keyframe dans `apps/web/src/theme/tokens.motion.css` (à la fin du fichier) :
```css
@keyframes ab-reveal {
  from {
    opacity: 0;
    transform: translateY(var(--reveal-from, 16px));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 5: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/primitives/CountUp.test.tsx apps/web/src/motion/primitives/Reveal.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/motion/primitives/CountUp.tsx apps/web/src/motion/primitives/Reveal.tsx apps/web/src/motion/primitives/CountUp.test.tsx apps/web/src/motion/primitives/Reveal.test.tsx apps/web/src/theme/tokens.motion.css
git commit -m "feat(web): primitives CountUp et Reveal (motion-safe)"
```

---

## Task 7: Primitives `<Stagger>` et `<AnimatedBar>`

**Files:**
- Create: `apps/web/src/motion/primitives/Stagger.tsx`
- Create: `apps/web/src/motion/primitives/AnimatedBar.tsx`
- Test: `apps/web/src/motion/primitives/AnimatedBar.test.tsx`

**Interfaces:**
- Consumes: `useReducedMotion` (Task 3).
- Produces :
  - `<Stagger step?: number, children >` — révèle chaque enfant direct avec un délai croissant.
  - `<AnimatedBar value: number, max: number, color: string, grow?: 'up', label?: string />` — hauteur = `value/max`, animée via `transform: scaleY`.

- [ ] **Step 1: Écrire le test (AnimatedBar : hauteur proportionnelle, ratio borné)**

Créer `apps/web/src/motion/primitives/AnimatedBar.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { AnimatedBar } from './AnimatedBar.js'

describe('AnimatedBar', () => {
  it('exprime la proportion value/max en scaleY', () => {
    const { container } = render(
      <MotionProvider>
        <AnimatedBar value={3} max={6} color="var(--brand)" />
      </MotionProvider>,
    )
    const bar = container.querySelector('[data-bar]') as HTMLElement
    expect(bar.style.getPropertyValue('--bar-scale')).toBe('0.5')
  })

  it('borne le ratio à 1 même si value > max', () => {
    const { container } = render(
      <MotionProvider>
        <AnimatedBar value={10} max={4} color="var(--brand)" />
      </MotionProvider>,
    )
    const bar = container.querySelector('[data-bar]') as HTMLElement
    expect(bar.style.getPropertyValue('--bar-scale')).toBe('1')
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/motion/primitives/AnimatedBar.test.tsx`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Écrire AnimatedBar**

Créer `apps/web/src/motion/primitives/AnimatedBar.tsx` :
```tsx
import { useReducedMotion } from '../MotionProvider.js'

/** Barre qui « pousse » via transform: scaleY (composité, 60fps) plutôt que
 * height (reflow). En reduced-motion, la barre est directement à sa hauteur
 * finale sans transition. */
export function AnimatedBar({
  value,
  max,
  color,
  grow = 'up',
  label,
}: {
  value: number
  max: number
  color: string
  grow?: 'up'
  label?: string
}) {
  const reduced = useReducedMotion()
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div
      data-bar
      aria-label={label}
      style={{
        ['--bar-scale' as string]: String(ratio),
        background: color,
        transformOrigin: grow === 'up' ? 'bottom' : 'top',
        transform: 'scaleY(var(--bar-scale))',
        transition: reduced ? 'none' : 'transform var(--dur-slow) var(--ease-out)',
        height: '100%',
        width: '100%',
        borderRadius: 'var(--radius-sm)',
      }}
    />
  )
}
```

- [ ] **Step 4: Écrire Stagger**

Créer `apps/web/src/motion/primitives/Stagger.tsx` :
```tsx
import { Children, isValidElement, type ReactNode } from 'react'
import { Reveal } from './Reveal.js'

/** Révèle chaque enfant direct avec un délai croissant (`index * step` ms).
 * En reduced-motion, Reveal rend tout immédiatement (aucun délai appliqué). */
export function Stagger({ step = 60, children }: { step?: number; children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) =>
        isValidElement(child) ? (
          <Reveal key={child.key ?? i} delay={i * step}>
            {child}
          </Reveal>
        ) : (
          child
        ),
      )}
    </>
  )
}
```

- [ ] **Step 5: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/primitives/AnimatedBar.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/motion/primitives/Stagger.tsx apps/web/src/motion/primitives/AnimatedBar.tsx apps/web/src/motion/primitives/AnimatedBar.test.tsx
git commit -m "feat(web): primitives Stagger et AnimatedBar"
```

---

## Task 8: `<PhaseTransition>`, `<Confetti>`, `<MediaOverlay>`

**Files:**
- Create: `apps/web/src/motion/primitives/PhaseTransition.tsx`
- Create: `apps/web/src/motion/primitives/Confetti.tsx`
- Create: `apps/web/src/motion/primitives/MediaOverlay.tsx`
- Test: `apps/web/src/motion/primitives/PhaseTransition.test.tsx`

**Interfaces:**
- Consumes: `useReducedMotion` (Task 3), `framer-motion` (isolé ici).
- Produces :
  - `<PhaseTransition phaseKey: string, children >` — crossfade entre phases (Framer caché).
  - `<Confetti active: boolean />` — canvas de particules, monté seulement si `active`.
  - `<MediaOverlay src: string, mode: 'overlay' | 'background', active: boolean />`.

- [ ] **Step 1: Écrire le test (PhaseTransition rend la phase courante ; Confetti inactif = rien)**

Créer `apps/web/src/motion/primitives/PhaseTransition.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../MotionProvider.js'
import { PhaseTransition } from './PhaseTransition.js'
import { Confetti } from './Confetti.js'

describe('PhaseTransition', () => {
  it('rend le contenu de la phase courante', () => {
    render(
      <MotionProvider>
        <PhaseTransition phaseKey="question">
          <p>question en cours</p>
        </PhaseTransition>
      </MotionProvider>,
    )
    expect(screen.getByText('question en cours')).toBeDefined()
  })
})

describe('Confetti', () => {
  it('ne monte aucun canvas quand inactif', () => {
    const { container } = render(
      <MotionProvider>
        <Confetti active={false} />
      </MotionProvider>,
    )
    expect(container.querySelector('canvas')).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/motion/primitives/PhaseTransition.test.tsx`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Écrire PhaseTransition (seul point d'usage de framer-motion)**

Créer `apps/web/src/motion/primitives/PhaseTransition.tsx` :
```tsx
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useReducedMotion } from '../MotionProvider.js'

/** Enveloppe le switch de phase : sortie/entrée en crossfade. Framer Motion est
 * ISOLÉ ici (aucun écran ne l'importe). Ne touche pas au focus : les écrans
 * gardent la main via leurs headingRef (RGAA 2.4.3). */
export function PhaseTransition({ phaseKey, children }: { phaseKey: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const duration = reduced ? 0 : 0.35
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phaseKey}
        initial={{ opacity: reduced ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: reduced ? 1 : 0 }}
        transition={{ duration }}
        style={{ height: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 4: Écrire Confetti**

Créer `apps/web/src/motion/primitives/Confetti.tsx` :
```tsx
import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../MotionProvider.js'

/** Célébration : particules sur un <canvas> en overlay (aucun reflow DOM).
 * Monté seulement quand `active`. aria-hidden (purement décoratif). Coupé en
 * reduced-motion. */
export function Confetti({ active }: { active: boolean }) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active || reduced) return
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const colors = ['#e88a3c', '#4fa3a0', '#f2a900', '#d96a52']
    const parts = Array.from({ length: 120 }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height,
      vy: 2 + Math.random() * 3,
      vx: -1 + Math.random() * 2,
      size: 4 + Math.random() * 6,
      color: colors[i % colors.length],
    }))
    let raf = 0
    let stopped = false
    const started = performance.now()
    function frame(now: number) {
      if (stopped || !ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of parts) {
        p.x += p.vx
        p.y += p.vy
        ctx.fillStyle = p.color
        ctx.fillRect(p.x, p.y, p.size, p.size)
      }
      if (now - started < 4000) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [active, reduced])

  if (!active || reduced) return null
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
```

- [ ] **Step 5: Écrire MediaOverlay**

Créer `apps/web/src/motion/primitives/MediaOverlay.tsx` :
```tsx
import { useState } from 'react'

/** Fond animé / stinger vidéo. <video> muet + playsInline + loop (autoplay muet
 * autorisé). Fallback dégradé si la vidéo ne charge pas. aria-hidden : décoratif.
 * `src` = clé résolue vers /media/<src>.mp4 dans apps/web/public/media/. */
export function MediaOverlay({
  src,
  mode,
  active,
}: {
  src: string
  mode: 'overlay' | 'background'
  active: boolean
}) {
  const [failed, setFailed] = useState(false)
  if (!active) return null

  const base = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    zIndex: mode === 'background' ? 0 : 5,
    pointerEvents: 'none' as const,
  }

  if (failed) {
    return <div aria-hidden="true" style={{ ...base, background: 'var(--grad-brand)' }} />
  }
  return (
    <video
      aria-hidden="true"
      autoPlay
      muted
      playsInline
      loop={mode === 'background'}
      onError={() => setFailed(true)}
      src={`/media/${src}.mp4`}
      style={base}
    />
  )
}
```

- [ ] **Step 6: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/primitives/PhaseTransition.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/motion/primitives/PhaseTransition.tsx apps/web/src/motion/primitives/Confetti.tsx apps/web/src/motion/primitives/MediaOverlay.tsx apps/web/src/motion/primitives/PhaseTransition.test.tsx
git commit -m "feat(web): PhaseTransition (framer isolé), Confetti, MediaOverlay"
```

---

## Task 9: Surface publique `index.ts` + peuplement du registre

**Files:**
- Create: `apps/web/src/motion/index.ts`
- Create: `apps/web/src/motion/effects.ts`
- Modify: `apps/web/src/motion/registry.ts`
- Test: `apps/web/src/motion/registry.test.ts`

**Interfaces:**
- Consumes: primitives (Tasks 6-8), `CueContext` (Task 3).
- Produces :
  - `effects.ts` : `pulseGreen(ctx)`, `shake(ctx)`, `sweepIn(ctx)` — fonctions `(ctx: CueContext) => void` utilisant WAAPI (`el.animate`).
  - `registry` peuplé pour les moments de jeu.
  - `index.ts` : ré-exporte `MotionProvider, useCue, Cue, useReducedMotion, useSound`, primitives, `ThemeProvider`.

- [ ] **Step 1: Écrire le test (le registre couvre les moments clés et pointe des sons valides)**

Créer `apps/web/src/motion/registry.test.ts` :
```ts
import { describe, expect, it } from 'vitest'
import { registry } from './registry.js'
import { sounds } from './sound/sounds.js'

describe('registre de cues (moments de jeu)', () => {
  it('couvre les moments de jeu clés', () => {
    for (const cue of ['phase.enter:podium', 'answer.correct', 'answer.incorrect', 'timer.urgent']) {
      expect(registry[cue], `manque: ${cue}`).toBeDefined()
    }
  })

  it('chaque sound référencé existe dans le catalogue', () => {
    for (const effect of Object.values(registry)) {
      if (effect?.sound) expect(sounds[effect.sound]).toBeDefined()
    }
  })
})
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/motion/registry.test.ts`
Expected: FAIL (registre vide : `phase.enter:podium` non défini).

- [ ] **Step 3: Écrire les fonctions d'effet (WAAPI, sans framer)**

Créer `apps/web/src/motion/effects.ts` :
```ts
import type { CueContext } from './cues.js'

/** Effets visuels ponctuels via la Web Animations API (el.animate) : pas besoin
 * de framer-motion pour ces micro-animations ancrées à un élément. Chaque effet
 * est un no-op si aucun élément n'est fourni. */

export function pulseGreen(ctx: CueContext): void {
  ctx.el?.animate(
    [{ boxShadow: '0 0 0 0 rgba(95,167,120,0.7)' }, { boxShadow: '0 0 0 12px rgba(95,167,120,0)' }],
    { duration: 500, easing: 'cubic-bezier(0.22,1,0.36,1)' },
  )
}

export function shake(ctx: CueContext): void {
  ctx.el?.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 320, easing: 'ease-in-out' },
  )
}

export function sweepIn(ctx: CueContext): void {
  ctx.el?.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], {
    duration: 700,
    easing: 'cubic-bezier(0.34,1.56,0.64,1)',
    fill: 'both',
  })
}
```

- [ ] **Step 4: Peupler le registre**

Remplacer la dernière ligne de `apps/web/src/motion/registry.ts` (`export const registry … = {}`) par :
```ts
import { pulseGreen, shake, sweepIn } from './effects.js'

/**
 * LA table cue → effets. Ajouter une animation/son/vidéo « partout » = éditer
 * CE fichier, jamais un écran.
 */
export const registry: Partial<Record<string, CueEffect>> = {
  'phase.enter:podium': {
    animation: sweepIn,
    sound: 'fanfare',
    media: { src: 'confetti-bg', mode: 'overlay' },
  },
  'phase.enter:scoreboard': { animation: sweepIn },
  'phase.enter:reveal': { animation: sweepIn },
  'answer.correct': { animation: pulseGreen, sound: 'ding' },
  'answer.incorrect': { animation: shake, sound: 'buzz' },
  'timer.urgent': { sound: 'tick', reducedMotion: 'skip' },
  'player.join': { sound: 'ding' },
}
```
(Conserver les imports `CueContext`/`SoundId` en tête de fichier ajoutés en Task 3.)

- [ ] **Step 5: Écrire la surface publique**

Créer `apps/web/src/motion/index.ts` :
```ts
export { MotionProvider, useReducedMotion } from './MotionProvider.js'
export { useCue, Cue } from './useCue.js'
export { useSound } from './sound/useSound.js'
export { Reveal } from './primitives/Reveal.js'
export { Stagger } from './primitives/Stagger.js'
export { CountUp } from './primitives/CountUp.js'
export { AnimatedBar } from './primitives/AnimatedBar.js'
export { Confetti } from './primitives/Confetti.js'
export { MediaOverlay } from './primitives/MediaOverlay.js'
export { PhaseTransition } from './primitives/PhaseTransition.js'
export type { Cue as CueName, CueContext } from './cues.js'
```

- [ ] **Step 6: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/registry.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/motion/effects.ts apps/web/src/motion/registry.ts apps/web/src/motion/index.ts apps/web/src/motion/registry.test.ts
git commit -m "feat(web): effets WAAPI, peuplement du registre (moments de jeu), surface publique"
```

---

## Task 10: Câblage AppShell + BigScreen (thème scene, cues, animations)

**Files:**
- Modify: `apps/web/src/AppShell.tsx`
- Modify: `apps/web/src/screens/BigScreen.tsx`
- Test: `apps/web/src/screens/BigScreen.motion.test.tsx`

**Interfaces:**
- Consumes: `MotionProvider`, `ThemeProvider`, `PhaseTransition`, `AnimatedBar`, `CountUp`, `Confetti`, `useCue` (Task 9).
- Produces: rien (intégration terminale).

- [ ] **Step 1: Monter MotionProvider dans AppShell**

Dans `apps/web/src/AppShell.tsx`, ajouter l'import et envelopper l'`<Outlet>`. Remplacer le corps du composant :
```tsx
import { Outlet } from 'react-router-dom'
import { SessionProvider } from './api/auth'
import { MotionProvider } from './motion/index.js'
import './tokens.css'
import './prototype.css'

export function AppShell() {
  return (
    <SessionProvider>
      <MotionProvider>
        <div className="prototype-root">
          <a className="ab-skip-link" href="#contenu-principal">
            Aller au contenu
          </a>
          <Outlet />
        </div>
      </MotionProvider>
    </SessionProvider>
  )
}
```
(Le commentaire de tête existant est conservé.)

- [ ] **Step 2: Écrire le test d'intégration BigScreen (thème scene appliqué)**

Créer `apps/web/src/screens/BigScreen.motion.test.tsx` :
```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MotionProvider } from '../motion/index.js'
import { BigScreen } from './BigScreen.js'

describe('BigScreen — habillage motion', () => {
  it('monte la sous-arborescence en thème scene / schéma dark', () => {
    const { container } = render(
      <MotionProvider>
        <MemoryRouter initialEntries={['/screen/s1?token=&pin=1234']}>
          <Routes>
            <Route path="/screen/:sessionId" element={<BigScreen />} />
          </Routes>
        </MemoryRouter>
      </MotionProvider>,
    )
    const scene = container.querySelector('[data-theme="scene"]')
    expect(scene).not.toBeNull()
    expect(scene?.getAttribute('data-scheme')).toBe('dark')
  })
})
```

- [ ] **Step 3: Lancer, vérifier l'échec**

Run: `pnpm test -- apps/web/src/screens/BigScreen.motion.test.tsx`
Expected: FAIL (pas de `[data-theme="scene"]` : BigScreen n'enveloppe pas encore de ThemeProvider).

- [ ] **Step 4: Envelopper BigScreen dans ThemeProvider (scene/dark)**

Dans `apps/web/src/screens/BigScreen.tsx` :

Ajouter les imports en tête :
```tsx
import { ThemeProvider } from '../theme/ThemeProvider.js'
import { AnimatedBar, Confetti, CountUp, PhaseTransition, useCue } from '../motion/index.js'
```

Envelopper le `return (<main className="big-screen" …>…</main>)` : renommer le composant interne actuel en `BigScreenInner` (garder tout son corps tel quel) et ajouter un wrapper exporté :
```tsx
export function BigScreen() {
  return (
    <ThemeProvider theme="scene" scheme="dark">
      <BigScreenInner />
    </ThemeProvider>
  )
}
```
(La fonction existante `export function BigScreen()` devient `function BigScreenInner()` — retirer le `export` sur cette ligne.)

- [ ] **Step 5: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/screens/BigScreen.motion.test.tsx`
Expected: 1 test PASS.

- [ ] **Step 6: Émettre les cues de phase (dans BigScreenInner)**

Dans `BigScreenInner`, ajouter après la ligne `const { socket, emitAck, on } = useGameSocket()` :
```tsx
  const cue = useCue()
```
Dans l'effet d'abonnements (celui qui contient `offReveal`/`offPodium`), enrichir les handlers existants :
- dans `offShow` (handler de `question:show`), avant `setPhase('question')`, ajouter : `cue('phase.enter:question')`
- dans `offReveal`, avant `setPhase('reveal')`, ajouter : `cue('phase.enter:reveal')`
- dans `offPodium`, avant `setPhase('podium')`, ajouter : `cue('phase.enter:podium')`
- dans l'effet de bascule auto vers scoreboard (`setPhase('scoreboard')`), ajouter juste avant : `cue('phase.enter:scoreboard')`

- [ ] **Step 7: Animer les scores (scoreboard) via CountUp**

Dans le bloc `phase === 'scoreboard'`, remplacer `<span className="big-scoreboard__score">{p.score} pts</span>` par :
```tsx
<span className="big-scoreboard__score">
  <CountUp value={p.score} format={(n) => `${n} pts`} />
</span>
```

- [ ] **Step 8: Animer les barres de distribution (reveal) via AnimatedBar**

Dans `renderDistribution()`, remplacer le `<div className="big-distribution__bar" style={{ height: … }} />` par :
```tsx
<div className="big-distribution__bar" style={{ height: `${(row.count / maxCount) * 100}%` }}>
  <AnimatedBar
    value={row.count}
    max={maxCount}
    color={row.shape ? `var(--ans-${row.shape})` : 'var(--brand-2)'}
  />
</div>
```
(La hauteur du conteneur reste pilotée par le ratio ; `AnimatedBar` anime le remplissage à l'intérieur.)

- [ ] **Step 9: Ajouter la célébration confetti au podium**

Dans le bloc `phase === 'podium'`, envelopper le `<PodiumView …/>` :
```tsx
<div style={{ position: 'relative' }}>
  <Confetti active />
  <PodiumView quizTitle={quizTitle} top={podiumTop} fullRanking={ranking} headingRef={podiumHeadingRef} showConversionFooter />
</div>
```

- [ ] **Step 10: Typecheck + suite complète**

Run: `pnpm --filter @splootlabs/web typecheck`
Expected: aucune erreur de types.
Run: `pnpm test`
Expected: toute la suite verte (dont les tests existants de BigScreen s'il y en a).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/AppShell.tsx apps/web/src/screens/BigScreen.tsx apps/web/src/screens/BigScreen.motion.test.tsx
git commit -m "feat(web): câble le grand écran sur l'abstraction motion (thème scene, cues, CountUp, barres animées, confetti)"
```

---

## Task 11: Câblage PlayerLive (feedback réponse + timer urgent) et Home (thème app)

**Files:**
- Modify: `apps/web/src/screens/PlayerLive.tsx`
- Modify: `apps/web/src/screens/Home.tsx`

**Interfaces:**
- Consumes: `useCue`, `Cue`, `useSound` (Task 9), `ThemeProvider` (Task 2).
- Produces: rien (intégration terminale).

- [ ] **Step 1: Débloquer le son au premier geste + émettre les cues de réponse (PlayerLive)**

Dans `apps/web/src/screens/PlayerLive.tsx`, ajouter les imports :
```tsx
import { useCue, useSound } from '../motion/index.js'
```
Dans le composant, ajouter :
```tsx
  const cue = useCue()
  const sound = useSound()
```
Au handler de soumission de réponse existant (là où le joueur valide son choix), ajouter en première ligne du handler : `sound.unlock()` (débloque l'audio sur ce geste utilisateur) puis `cue('answer.submit')`.

Au handler de `question:reveal` (là où l'écran apprend si la réponse du joueur était correcte), émettre selon le résultat déjà calculé : `cue(estCorrect ? 'answer.correct' : 'answer.incorrect')`.

> Repère d'implémentation : PlayerLive connaît déjà la correction au reveal (il affiche un état correct/incorrect). Réutiliser cette variable booléenne existante — ne pas recalculer. Si elle n'existe pas sous forme booléenne, la dériver du payload `question:reveal` déjà reçu.

- [ ] **Step 2: Cue timer urgent (≤ 5 s)**

Dans l'effet/rendu où `remaining` est connu, ajouter un effet :
```tsx
  useEffect(() => {
    if (remaining === 5) cue('timer.urgent')
  }, [remaining, cue])
```
(Émis une seule fois au passage à 5 s, pas à chaque tick.)

- [ ] **Step 3: Thème app + Reveal sur Home**

Dans `apps/web/src/screens/Home.tsx`, ajouter les imports :
```tsx
import { ThemeProvider } from '../theme/ThemeProvider.js'
import { Stagger } from '../motion/index.js'
```
Envelopper le contenu rendu par Home dans `<ThemeProvider theme="app">…</ThemeProvider>`. Autour de la liste des quiz/parties récentes (la `<ul>`/`<ol>` existante), envelopper ses items d'un `<Stagger>` :
```tsx
<Stagger step={50}>
  {items.map(/* rendu d'item existant, inchangé */)}
</Stagger>
```
(Adapter au nom de variable réel de la liste dans Home ; ne pas modifier le rendu de chaque item.)

- [ ] **Step 4: Typecheck + suite complète**

Run: `pnpm --filter @splootlabs/web typecheck`
Expected: aucune erreur.
Run: `pnpm test`
Expected: suite verte.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/PlayerLive.tsx apps/web/src/screens/Home.tsx
git commit -m "feat(web): câble le retour joueur (feedback réponse + timer urgent) et le thème app sur Home"
```

---

## Task 12: Garde d'architecture (interdiction d'importer framer-motion hors de motion/)

**Files:**
- Test: `apps/web/src/motion/architecture.test.ts`

**Interfaces:**
- Consumes: arborescence de fichiers `apps/web/src`.
- Produces: rien (test de garde).

- [ ] **Step 1: Écrire le test de garde**

Créer `apps/web/src/motion/architecture.test.ts` :
```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const MOTION_DIR = join(SRC, 'motion')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

describe('garde d\'architecture', () => {
  it("aucun fichier hors motion/ n'importe framer-motion", () => {
    const offenders = walk(SRC)
      .filter((p) => !p.startsWith(MOTION_DIR))
      .filter((p) => /from ['"]framer-motion['"]/.test(readFileSync(p, 'utf8')))
    expect(offenders, `framer-motion importé hors de motion/: ${offenders.join(', ')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer, vérifier PASS**

Run: `pnpm test -- apps/web/src/motion/architecture.test.ts`
Expected: PASS (seul `PhaseTransition.tsx`, dans `motion/`, importe framer-motion).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/motion/architecture.test.ts
git commit -m "test(web): garde d'architecture — framer-motion confiné à motion/"
```

---

## Task 13: Placeholders d'assets média (sons/vidéos) + README motion

**Files:**
- Create: `apps/web/public/sfx/.gitkeep`
- Create: `apps/web/public/media/.gitkeep`
- Create: `apps/web/src/motion/README.md`

**Interfaces:**
- Consumes: rien.
- Produces: dossiers d'assets + doc d'usage. Tant que les `.mp3`/`.mp4` réels sont absents, les cues son/média sont des no-op (silence / fallback dégradé) — l'app fonctionne.

- [ ] **Step 1: Créer les dossiers d'assets**

Créer `apps/web/public/sfx/.gitkeep` (fichier vide) et `apps/web/public/media/.gitkeep` (fichier vide).

- [ ] **Step 2: Écrire le README d'usage**

Créer `apps/web/src/motion/README.md` :
```markdown
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
```

- [ ] **Step 3: Vérifier la suite complète**

Run: `pnpm test`
Expected: toute la suite verte.

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/sfx/.gitkeep apps/web/public/media/.gitkeep apps/web/src/motion/README.md
git commit -m "docs(web): dossiers d'assets média + README de la couche motion"
```

---

## Self-Review

**Couverture de la spec** (chaque section → tâche) :
- §3 Couches / arborescence → Tasks 2-9 (fichiers créés aux emplacements prévus).
- §4 Tokens & thèmes (2 axes orthogonaux, motion tokens, contrastes) → Task 2. *Note : la re-validation des contrastes `--ans-*` en thème clair (§4) est signalée mais non couverte par un test automatisé — action manuelle à faire lors du peuplement du thème `app` ; ajoutée comme rappel dans le README (Task 13) et ici.*
- §5 Moteur de cues (taxonomie, effet, registre, API, no-op) → Task 3 + Task 9.
- §6 Primitives (Reveal/Stagger/CountUp/AnimatedBar/Confetti/PhaseTransition/graphes animés) → Tasks 5-8. *TimerRing → stroke-dashoffset continu (§6) : reporté, voir « Hors périmètre de ce plan » ci-dessous.*
- §7 SoundManager → Task 4.
- §8 MediaOverlay → Task 8.
- §9 Intégration écrans → Tasks 10-11.
- §10 Accessibilité/reduced-motion → tissé dans chaque primitive (Tasks 6-8) + garde focus non modifiée (Task 10 Step 4 conserve les headingRef).
- §11 Tests (registre, SoundManager, primitives, garde d'archi, non-régression) → Tasks 3,4,6,7,9,12 + `pnpm test` complet aux Tasks 10-11-13.
- §12 Migration incrémentale → l'ordre des tâches suit les 5 étapes (tokens → socle → primitives → semis → peuplement).
- §13 Dépendances → Task 1.
- §14 Hors périmètre → respecté (pas d'éditeur d'animations, pas de theming par tenant, pas de charting générique).

**Hors périmètre de ce plan (reporté explicitement, cohérent avec la spec)** :
- Migration de `TimerRing` vers `stroke-dashoffset` continu (§6) : amélioration, non bloquante ; l'anneau actuel reste fonctionnel. À planifier en suivi.
- Musique de lobby en boucle (`sound.loop('lobby')`) : l'API `loop` existe (Task 4) mais n'est câblée à aucun écran ici — câblage trivial en suivi une fois l'asset produit.
- Re-vérification automatisée des contrastes `--ans-*` en thème `app`.

**Scan placeholders** : aucun « TBD/TODO/etc. » — chaque step porte du code réel ou une commande exacte. Les seuls repères « adapter au nom réel » (Task 11 Steps 1,3) concernent des variables locales d'écrans existants que l'implémenteur lit directement ; le comportement et les signatures d'API sont, eux, entièrement spécifiés.

**Cohérence des types** : `Cue`/`CueContext`/`CueEffect` définis en Task 3, consommés à l'identique en Tasks 6-9 ; `SoundId` défini en Task 4, référencé par `registry.ts` (Task 3/9) et `sounds.ts` ; `useReducedMotion`/`useCue`/`useSound`/`useMotion` définis en Tasks 3-4, ré-exportés en Task 9, consommés en Tasks 6-11. `MotionProvider`↔`SoundManager` : dépendance croisée signalée (note d'ordonnancement Task 3 Step 7).
