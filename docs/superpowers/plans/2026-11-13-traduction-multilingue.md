# Traduction multilingue de l'application, plan de mise en œuvre

> Pour les agents : sous-compétence requise, superpowers:subagent-driven-development (recommandée) ou superpowers:executing-plans, tâche par tâche. Les étapes sont des cases à cocher (`- [ ]`).

Objectif : l'application (app.pengou.fr, `apps/web`, et tout ce que le serveur renvoie à l'écran ou par courriel) s'affiche en français, en anglais ou en espagnol, le français restant la langue principale.

Architecture : un noyau commun dans `@splootlabs/shared/i18n` (langues, détection, interpolation, pluriel). Côté navigateur, le texte français reste écrit dans le code et sert de clé, à la manière de gettext ; des catalogues typés anglais et espagnol, découpés par zone de l'application, donnent la traduction, et TypeScript refuse une clé inconnue ou une traduction manquante. Côté serveur, les messages d'erreur sont traduits à la sortie (crochet Fastify et réponses Socket.IO) d'après la langue que le client annonce, et les courriels et le quiz d'exemple sont produits dans la langue de la requête.

Pile : TypeScript, React 19, Fastify, Socket.IO, Vitest, Biome. Aucune dépendance nouvelle : `Intl.PluralRules`, `Intl.DateTimeFormat`, `Intl.NumberFormat` et `Intl.DisplayNames` suffisent.

Spécification : pas de document séparé. Julien a demandé « la traduction du site en multi-langue : en, es, et fr en principal », sans autre précision ; les décisions ci-dessous sont des choix de Claude, à relire.

## Décisions (choix de Claude)

1. Périmètre : l'application de ce dépôt. La vitrine `D:\Source\pengou-site` (pengou.fr) est un autre chantier, hors de ce plan. Les CGU et la politique de confidentialité, hébergées sur la vitrine, restent en français ; seuls les libellés qui y renvoient sont traduits.
2. Pas de préfixe de langue dans les URL : l'application est `noindex`, l'intérêt SEO est nul et les liens partagés (`/join`, `/invitations/:token`) doivent marcher pour tous.
3. Choix de la langue, dans l'ordre : paramètre d'URL `?lang=fr|en|es` (posé par les liens de la vitrine traduite ; s'il est valide, il est enregistré comme un choix explicite), puis valeur enregistrée `localStorage['pengou.lang']`, puis la première langue prise en charge de `navigator.languages`, puis le français. Un sélecteur natif `<select>` (« Français », « English », « Español », chacun avec son attribut `lang`) permet de changer à tout moment ; le changement s'applique sans rechargement.
4. Le client annonce sa langue au serveur : en-tête `Accept-Language` posé sur chaque `fetch` de `client.ts`, champ `lang` dans le `auth` du handshake Socket.IO, paramètre `?lang=` sur le lien de téléchargement CSV.
5. Pas de colonne de langue en base. Un courriel part dans la langue de la requête qui le déclenche (inscription, mot de passe oublié, invitation : langue de l'invitant).
6. Le contenu des quiz écrit par les hôtes n'est jamais traduit. Le quiz d'exemple (inscription et démonstration) existe en trois versions. La bibliothèque filtre par défaut sur la langue de l'interface quand elle propose des quiz dans cette langue, sinon sur « toutes ».
7. Ton : le français garde ses usages actuels (« vous » pour l'hôte, « tu » pour les joueurs) ; l'anglais dit « you » ; l'espagnol tutoie partout (« tú »), usage courant des applications de jeu.
8. Catalogues chargés avec le bundle principal (quelques dizaines de Ko non compressés) : pas de chargement différé, pour garder un code simple.

## Contraintes globales

- Node 24 : préfixer les commandes par `export PATH="/c/Users/julie/AppData/Roaming/nvm/v24.22.2:$PATH"` dans le shell Bash.
- Vérifications avant chaque commit : `pnpm vitest run <fichiers touchés>`, `pnpm typecheck`, `pnpm lint` (code de sortie 0, la CI bloque sur Biome). Formater avec `pnpm format`.
- Le texte français affiché ne change pas d'un caractère : il sert de clé et les tests existants le cherchent tel quel. Seule exception, une correction de faute repérée en passant, signalée dans le compte rendu.
- Règles typographiques de Julien, pour les trois langues : ni tiret cadratin ni demi-cadratin comme ponctuation, pas d'émoji décoratif, apostrophe droite `'`. L'espagnol ouvre ses questions et exclamations (`¿`, `¡`).
- Une clé contenant `{nom}` garde exactement les mêmes marqueurs dans les trois langues.
- Glossaire imposé (fr, en, es) : partie, game, partida ; hôte ou animateur, host, anfitrión ; joueur, player, jugador ; pseudo, nickname, apodo ; Code banquise, Ice floe code, Código del témpano ; grand écran, big screen, pantalla grande ; espace de travail ou workspace, workspace, espacio de trabajo ; bibliothèque, library, biblioteca ; QCM, multiple choice, opción múltiple ; vrai ou faux, true or false, verdadero o falso ; curseur, slider, deslizador ; sondage, poll, encuesta ; nuage de mots, word cloud, nube de palabras ; podium, podium, podio ; CGU, terms of use, condiciones de uso ; manchot, penguin, pingüino ; quiz, quiz, quiz.
- Messages de commit en français, conventionnels (`feat(i18n): …`), terminés par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Points d'attention pour la relecture

1. Navigateur en allemand ou en portugais : l'application s'ouvre en français, jamais sur des clés brutes ni en anglais par défaut. Test dans la tâche 1 (`matchLang`).
2. `localStorage` inaccessible (navigation privée stricte, iframe) : la langue se déduit du navigateur et le sélecteur fonctionne pour la session, sans exception. Test dans la tâche 2.
3. Changement de langue en pleine partie côté joueur : l'écran se retraduit immédiatement sans perdre la connexion ni l'état de la partie. Test dans la tâche 7.
4. Message d'erreur serveur variable (avec un identifiant ou un nombre) : traduit avec sa valeur, et un message inconnu reste en français plutôt que de disparaître. Test dans la tâche 8.
5. Pluriels autour de zéro et un (« 0 joueur » en français, « 0 players », « 0 jugadores ») : test dans la tâche 1 (`pluralCategory`) et dans la tâche 6 (compteur de joueurs de l'hôte).

---

### Tâche 1 : noyau i18n partagé

Fichiers :
- Créer : `packages/shared/src/i18n.ts`, `packages/shared/src/i18n.test.ts`
- Modifier : `packages/shared/package.json` (export `./i18n` sur le modèle de `./signup-source`)

Interfaces produites (utilisées par toutes les tâches suivantes) :

```ts
export const LANGS = ['fr', 'en', 'es'] as const
export type Lang = (typeof LANGS)[number]
export const DEFAULT_LANG: Lang = 'fr'
export const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en', es: 'es' }
export const LANG_NAMES: Record<Lang, string> = { fr: 'Français', en: 'English', es: 'Español' }
export type Catalog = Readonly<Record<string, string>>
export type Params = Readonly<Record<string, string | number>>
export function isLang(value: unknown): value is Lang
/** Chaîne : en-tête Accept-Language (pondérations q respectées, `*` ignoré). Tableau : navigator.languages, dans l'ordre. */
export function matchLang(prefs: string | readonly string[] | null | undefined): Lang
export function interpolate(template: string, params?: Params): string
/** fr : la clé interpolée. en, es : l'entrée du catalogue interpolée, ou la clé française si elle manque. */
export function translate(catalogs: { en: Catalog; es: Catalog }, lang: Lang, key: string, params?: Params): string
/** Intl.PluralRules ; toute catégorie autre que 'one' devient 'other'. */
export function pluralCategory(lang: Lang, count: number): 'one' | 'other'
/** Noms des marqueurs {nom} d'un texte, triés et sans doublon. */
export function placeholders(text: string): string[]
```

- [ ] Étape 1 : écrire `i18n.test.ts` avec ces assertions.

```ts
expect(matchLang('es-ES,es;q=0.9,en;q=0.8')).toBe('es')
expect(matchLang('de-DE,de;q=0.9')).toBe('fr')
expect(matchLang('de;q=1, en;q=0.5')).toBe('en')
expect(matchLang('en;q=0.2, es;q=0.8')).toBe('es')
expect(matchLang('EN-us')).toBe('en')
expect(matchLang('*')).toBe('fr')
expect(matchLang(['de-AT', 'pt-BR', 'en-US'])).toBe('en')
expect(matchLang(undefined)).toBe('fr')
expect(matchLang([])).toBe('fr')
expect(interpolate('{n} joueurs dans {lieu}', { n: 3, lieu: 'la salle' })).toBe('3 joueurs dans la salle')
expect(interpolate('Bonjour {inconnu}')).toBe('Bonjour {inconnu}')
const cat = { en: { 'Bonjour {nom}': 'Hello {nom}' }, es: {} }
expect(translate(cat, 'fr', 'Bonjour {nom}', { nom: 'Ana' })).toBe('Bonjour Ana')
expect(translate(cat, 'en', 'Bonjour {nom}', { nom: 'Ana' })).toBe('Hello Ana')
expect(translate(cat, 'es', 'Bonjour {nom}', { nom: 'Ana' })).toBe('Bonjour Ana')
expect(pluralCategory('fr', 0)).toBe('one')
expect(pluralCategory('en', 0)).toBe('other')
expect(pluralCategory('es', 0)).toBe('other')
expect(pluralCategory('en', 1)).toBe('one')
expect(pluralCategory('es', 1000000)).toBe('other')
expect(placeholders('{b} et {a} puis {b}')).toEqual(['a', 'b'])
expect(isLang('de')).toBe(false)
```

- [ ] Étape 2 : `pnpm vitest run packages/shared/src/i18n.test.ts`, échec attendu (module absent).
- [ ] Étape 3 : écrire `i18n.ts` et l'export du `package.json`.
- [ ] Étape 4 : relancer le test, succès attendu ; `pnpm typecheck` et `pnpm lint` propres.
- [ ] Étape 5 : commit `feat(i18n): noyau de traduction partagé (fr, en, es)`.

### Tâche 2 : mécanique de traduction du navigateur et sélecteur de langue

Fichiers :
- Créer : `apps/web/src/i18n/lang.ts`, `apps/web/src/i18n/catalog/define.ts`, `apps/web/src/i18n/catalog/common.ts`, `apps/web/src/i18n/catalog/index.ts`, `apps/web/src/i18n/t.ts`, `apps/web/src/i18n/useT.ts`, `apps/web/src/i18n/LanguageSelect.tsx`, `apps/web/src/i18n/i18n.test.tsx`
- Modifier : `apps/web/vitest.setup.ts`, `apps/web/src/api/client.ts` (en-tête `Accept-Language`, messages de repli de `fallbackMessage`), `apps/web/src/realtime/useGameSocket.ts` (`lang` dans le `auth` du handshake), `apps/web/src/ui/AppHeader.tsx` et l'écran de rejoindre `apps/web/src/screens/Join.tsx` (pose du sélecteur)

Interfaces :
- Consomme : tout le module de la tâche 1.
- Produit :

```ts
// lang.ts : état de langue hors React, une seule source de vérité.
export const LANG_STORAGE_KEY = 'pengou.lang'
export function getLang(): Lang            // initialisée à la première lecture (?lang= de l'URL, enregistré ; stockage ; navigator.languages ; 'fr')
export function setLang(lang: Lang): void  // enregistre (try/catch), pose <html lang>, prévient les abonnés
export function subscribeLang(listener: () => void): () => void
// catalog/define.ts
export function defineCatalog<K extends string>(c: { en: Record<K, string>; es: Record<K, string> }): { en: Record<K, string>; es: Record<K, string> }
// catalog/index.ts : fusion par décomposition des catalogues de zone ; chaque tâche d'écran y ajoute le sien.
export const catalog: { en: Record<WebKey, string>; es: Record<WebKey, string> }
export type WebKey = keyof typeof catalog.en
// t.ts : utilisable hors composant (lit getLang() à l'appel).
export function t(key: WebKey, params?: Params): string
/** Choisit `one` ou `other` selon pluralCategory ; `{n}` vaut `count` formaté par formatNumber. */
export function tp(count: number, one: WebKey, other: WebKey, params?: Params): string
export function formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string   // LOCALES[getLang()]
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string
// useT.ts : même API, et le composant se réaffiche au changement de langue (useSyncExternalStore sur subscribeLang).
export function useT(): { t: typeof t; tp: typeof tp; formatDate: typeof formatDate; formatNumber: typeof formatNumber; lang: Lang; setLang: typeof setLang }
// LanguageSelect.tsx
export function LanguageSelect(props: { className?: string }): JSX.Element   // <label> visuellement masqué « Langue » / « Language » / « Idioma »
```

- [ ] Étape 1 : écrire `i18n.test.tsx`. Cas : avec l'URL `/join?lang=es` et un stockage contenant `'en'`, `getLang()` vaut `'es'` et le stockage passe à `'es'` ; `?lang=de` est ignoré ; `getLang()` vaut `'es'` quand le stockage contient `'es'` ; vaut `'en'` avec un stockage vide et `navigator.languages` à `['en-US']` ; vaut `'fr'` quand `localStorage.getItem` lève et que `navigator.languages` vaut `['de-DE']` ; `setLang('en')` pose `document.documentElement.lang === 'en'` même quand `localStorage.setItem` lève ; un composant de test qui affiche `t('Annuler')` passe de « Annuler » à « Cancel » après un changement dans `LanguageSelect` (fireEvent.change), sans démontage ; `tp(0, '{n} joueur', '{n} joueurs')` donne « 0 joueur » en fr, « 0 players » en en ; l'en-tête `Accept-Language` envoyé par `apiGet` vaut la langue courante (espion sur `fetch`) ; pour chaque clé de `catalog.en`, `placeholders` donne le même résultat sur la clé, sur `catalog.en[k]` et sur `catalog.es[k]`.
- [ ] Étape 2 : lancer le test, échec attendu.
- [ ] Étape 3 : écrire le module. `catalog/common.ts` contient les textes génériques (Annuler, Enregistrer, Fermer, Retour, Réessayer, Chargement…, les deux formes de `{n} joueur(s)`, les messages de repli de `client.ts`, le libellé du sélecteur). Pour ne réinitialiser la langue qu'une fois par test, `vitest.setup.ts` ajoute, sous la garde `typeof window !== 'undefined'`, un `beforeEach` qui importe dynamiquement `./src/i18n/lang` et appelle `setLang('fr')` : jsdom annonce `en-US`, sans cela tous les tests existants basculeraient en anglais.
- [ ] Étape 4 : le sélecteur est rendu en tête des actions de `AppHeader` et sous le formulaire de `Join` ; `index.html` garde son texte français (application `noindex`), mais `setLang` et l'initialisation posent `<html lang>`.
- [ ] Étape 5 : relancer le test, puis toute la suite web `pnpm vitest run apps/web` : rien d'autre ne doit changer. `pnpm typecheck`, `pnpm lint`.
- [ ] Étape 6 : commit `feat(i18n): choix de la langue dans l'application`.

### Tâches 3 à 7 : traduction des écrans

Méthode commune, valable pour chacune de ces cinq tâches :
- Créer `apps/web/src/i18n/catalog/<zone>.ts` avec `defineCatalog`, l'ajouter à `catalog/index.ts`. Une clé déjà présente dans un autre catalogue de zone n'est pas redéfinie.
- Dans chaque fichier listé, tout texte visible ou lu par un lecteur d'écran (contenu JSX, `aria-label`, `title`, `alt`, `placeholder`, messages d'erreur et de validation, textes passés en props, `document.title`) passe par `t`, `tp` ou `useT`. Le texte d'une phrase coupée par des éléments JSX devient une clé par morceau cohérent ; une phrase avec une valeur devient une clé à marqueur (`'Partie {pin} terminée'`), jamais une concaténation. Ne pas traduire : identifiants, classes CSS, noms d'événements, textes saisis par les hôtes (questions, réponses, titres de quiz), pseudos.
- Dates et nombres : `formatDate` et `formatNumber` remplacent tout `Intl.*('fr-FR', …)` et tout `toLocaleString('fr-FR')`.
- Test ajouté par tâche : un fichier `<Écran>.i18n.test.tsx` qui affiche l'écran principal de la zone après `setLang('en')`, puis `setLang('es')`, et cherche deux textes traduits par rôle ou libellé. Les tests existants, en français, doivent passer sans modification.
- Fin de tâche : `grep` des lettres accentuées et des mots français courants dans les fichiers de la zone, hors commentaires et tests ; chaque reste est justifié dans le compte rendu. Puis `pnpm vitest run apps/web`, `pnpm typecheck`, `pnpm lint`, commit `feat(i18n): traduire <zone>`.

#### Tâche 3 : comptes et coquille

Catalogue `account.ts`. Fichiers : `App.tsx`, `AppShell.tsx`, `routes.tsx`, `RequireAuth.tsx`, `ui.tsx`, `ui/*.tsx` et `ui/useResendVerification.ts` (sauf `ui/wordcloud`, tâche 6), `api/auth.tsx`, `api/legal.ts` (`formatTermsDate` passe par `formatDate`), les messages d'erreur des autres `api/*.ts`, écrans `Login`, `Signup` (y compris la correspondance des codes d'erreur Better Auth), `ForgotPassword`, `ResetPassword`, `TermsRevalidation`, `AcceptInvitation`, `RouteError`, `Credits`. Test : `Login.i18n.test.tsx`, libellés « Email » et « Password » en anglais, « Correo electrónico » et « Contraseña » en espagnol.

#### Tâche 4 : accueil de l'hôte, bibliothèque, espace et rapports

Catalogue `host.ts`. Fichiers : `Home.tsx`, `Library.tsx`, `LibraryPreview.tsx`, `WorkspaceSettings.tsx`, `SessionReport.tsx`, `Demo.tsx`, `QuestionImageField.tsx`, `api/workspace-context.tsx`. Dans `Library.tsx`, `Intl.DisplayNames` prend `LOCALES[lang]`, et le filtre de langue vaut la langue de l'interface au premier chargement quand `meta.languages` la contient, sinon « toutes ». Dans `SessionReport.tsx`, le lien de téléchargement CSV reçoit `?lang=<langue>`. Tests : `Library.i18n.test.tsx` (en anglais, le filtre est présélectionné sur `en` quand le catalogue propose `fr` et `en`, et sur « All » quand il ne propose que `fr`), plus un rendu de `Home` en espagnol.

#### Tâche 5 : éditeur de quiz

Catalogue `editor.ts`. Fichier : `HostEditor.tsx` (le plus gros, 1 775 lignes ; les noms des types de question suivent le glossaire). Test : `HostEditor.i18n.test.tsx`, noms des types de question en anglais et en espagnol dans le menu d'ajout.

#### Tâche 6 : animation en direct et grand écran

Catalogue `live.ts`. Fichiers : `HostLive.tsx`, `BigScreen.tsx`, `ui/wordcloud/*.tsx`, `realtime/ackError.ts` et les textes de `realtime/*.ts`. Les annonces « N joueur(s) a/ont rejoint la partie » (`BigScreen.tsx:444`, `HostLive.tsx:472`) et le compteur `HostLive.tsx:874` passent par `tp`, plus aucun `> 1 ? 's'`. Tests : `BigScreen.i18n.test.tsx`, texte d'attente du salon en anglais et en espagnol (en reprenant le montage des tests `BigScreen.*.test.tsx` existants) ; `HostLive.i18n.test.tsx`, avec 0, 1 puis 2 joueurs au salon, le compteur affiche « 0 joueur », « 1 joueur », « 2 joueurs » en français, « 0 players », « 1 player », « 2 players » en anglais.

#### Tâche 7 : joueurs et podium

Catalogue `player.ts`. Fichiers : `Join.tsx`, `PlayerLive.tsx`, `PlayerPoll.tsx`, `PlayerWordcloud.tsx`, `Podium.tsx`, et les libellés éventuels de `motion/` (lecteurs d'écran). Tests : `PlayerLive.i18n.test.tsx` ; en reprenant le montage de `PlayerLive.rejoin.test.tsx`, passer de `fr` à `es` pendant une question ouverte : le texte change, la socket simulée ne reçoit ni déconnexion ni nouvel `emit` de connexion, la réponse reste possible.

### Tâche 8 : messages du serveur

Fichiers :
- Créer : `apps/server/src/i18n/catalog.ts`, `apps/server/src/i18n/localize.ts`, `apps/server/src/i18n/localize.test.ts`, `apps/server/src/i18n/catalog.test.ts`
- Modifier : `apps/server/src/app.ts` (enregistrement du crochet), `apps/server/src/game-gateway.ts` (langue du socket, `message(e, lang)`), `apps/server/src/csv.ts` ou `routes/sessions.ts` (en-têtes du CSV)

Interfaces :
- Consomme : `matchLang`, `isLang`, `interpolate`, `Lang` (tâche 1).
- Produit :

```ts
// catalog.ts : clés = messages français exacts émis par le serveur ; un message variable s'écrit avec des marqueurs ('session introuvable : {id}').
export const serverCatalog: { en: Record<ServerKey, string>; es: Record<ServerKey, string> }
// localize.ts
/** `?lang=` valide d'abord, puis l'en-tête Accept-Language, puis 'fr'. */
export function langOf(request: { headers: Record<string, string | string[] | undefined>; query?: unknown }): Lang
/** Correspondance exacte, puis clés à marqueurs (regex ancrée, chaque marqueur capture `(.+?)`) ; inconnu : message inchangé. */
export function localizeMessage(message: string, lang: Lang): string
/** Crochet onSend : réponse JSON portant un champ `error` de type chaîne, champ traduit selon langOf(request). */
export function registerErrorLocalization(app: FastifyInstance): void
```

- [ ] Étape 1 : `localize.test.ts`. `localizeMessage('Non authentifié.', 'en')` vaut « Not authenticated. », en espagnol « No autenticado. » ; `localizeMessage('session introuvable : abc-123', 'es')` vaut « sesión no encontrada: abc-123 » ; un message absent du catalogue revient inchangé ; `langOf` avec `query.lang = 'es'` et `Accept-Language: en` vaut `es`, avec `?lang=de` et `Accept-Language: en` vaut `en`. Un test d'intégration sur l'application Fastify (sur le modèle de `require-user.test.ts`) : `GET /api/me` sans session avec `Accept-Language: en` répond 401 et `{ error: 'Not authenticated.' }`, sans en-tête répond `{ error: 'Non authentifié.' }`, et les réponses sans champ `error` ne sont pas touchées (corps identique, `content-length` juste).
- [ ] Étape 2 : `catalog.test.ts`, garde-fou d'exhaustivité. Il lit les sources non-test de `apps/server/src` (hors `i18n/`) et de `packages/game/src`, extrait les littéraux des propriétés `error:` et des `new <Nom>Error(` (apostrophes, guillemets, gabarits ; `${…}` normalisé en `{}`), et vérifie que chaque message, normalisé de même, est une clé du catalogue, présente en anglais et en espagnol avec les mêmes marqueurs. Si un message est construit autrement (zod, concaténation), l'ajouter au catalogue sous forme de clé à marqueurs et le citer dans le compte rendu.
- [ ] Étape 3 : lancer les deux tests, échecs attendus.
- [ ] Étape 4 : écrire `localize.ts` et `catalog.ts` ; enregistrer le crochet dans `app.ts` ; dans `game-gateway.ts`, fixer `socket.data.lang` à la connexion (`handshake.auth.lang` s'il est valide, sinon `matchLang` de l'en-tête `accept-language` du handshake) et faire passer chaque `reply({ error: … })` par `localizeMessage`, y compris le cas `PlayerKickedError` ; traduire les en-têtes du CSV selon `langOf(request)`. Les réponses de Better Auth (`{ message, code }`) ne passent pas par ce crochet : le client les traduit déjà par code (tâche 3).
- [ ] Étape 5 : `pnpm vitest run apps/server/src/i18n apps/server/src/game-gateway.test.ts apps/server/src/require-user.test.ts`, puis la suite serveur complète (Docker requis), `pnpm typecheck`, `pnpm lint`.
- [ ] Étape 6 : commit `feat(i18n): messages du serveur dans la langue du client`.

### Tâche 9 : courriels et quiz d'exemple

Fichiers :
- Modifier : `packages/mail/src/templates/*.ts` et `templates.test.ts`, `packages/auth/src/auth.ts`, `apps/server/src/routes/invitations.ts`, `apps/server/src/example-quiz.ts`, `apps/server/src/routes/quizzes.ts`, `apps/server/src/routes/demo.ts`
- Test : `packages/mail/src/templates/templates.test.ts`, `apps/server/src/example-quiz.test.ts` (à créer)

Interfaces :
- Consomme : `Lang`, `DEFAULT_LANG`, `matchLang` (tâche 1), `langOf` (tâche 8).
- Produit : chaque gabarit prend un champ `lang: Lang` dans son objet d'entrée (`verifyEmailMail({ baseUrl, url, lang })`, idem pour `resetPasswordMail`, `passwordChangedMail`, `invitationMail`) ; `renderLayout` et `renderText` prennent `lang` (attribut `<html lang>`, pied de courriel). Les textes de chaque gabarit vivent dans le fichier du gabarit, sous la forme `const TEXT: Record<Lang, {...}>`. `export function exampleQuiz(lang: Lang): typeof EXAMPLE_QUIZ` remplace l'usage direct de `EXAMPLE_QUIZ` (la constante française reste exportée).

- [ ] Étape 1 : tests. Gabarits : pour chaque gabarit et chaque langue, l'objet, le texte et le HTML contiennent le titre attendu (en : « Confirm your email address », es : « Confirma tu dirección de correo ») et `<html lang="xx">` ; les tests français existants passent sans modification. Quiz d'exemple : `exampleQuiz('en').title` vaut « My first quiz (example) », `exampleQuiz('es').title` « Mi primer quiz (ejemplo) » ; pour les trois langues, même nombre de questions, mêmes types, mêmes `correct`, mêmes réglages de temps et de curseur que `EXAMPLE_QUIZ`.
- [ ] Étape 2 : lancer, échecs attendus.
- [ ] Étape 3 : implémenter. Dans `auth.ts`, la langue vient de l'objet requête que Better Auth passe en second argument de `sendResetPassword`, `onPasswordReset` et `sendVerificationEmail` (vérifier la signature dans les types de `better-auth` installés) : `matchLang(request?.headers.get('accept-language'))`, `DEFAULT_LANG` en son absence. L'invitation part dans `langOf(request)` de l'invitant. `quizzes.ts` et `demo.ts` créent `exampleQuiz(langOf(request))`.
- [ ] Étape 4 : tests ciblés, puis `pnpm vitest run packages/mail packages/auth apps/server/src/example-quiz-e2e.test.ts apps/server/src/invitations-email-e2e.test.ts apps/server/src/demo-e2e.test.ts`, `pnpm typecheck`, `pnpm lint`.
- [ ] Étape 5 : commit `feat(i18n): courriels et quiz d'exemple dans la langue de l'utilisateur`.

### Tâche 10 : vérification d'ensemble

- [ ] Étape 1 : chercher les restes de français non traduits dans `apps/web/src` (hors tests, commentaires et catalogues), corriger ou justifier.
- [ ] Étape 2 : lancer l'application (compétence `run`) et parcourir en anglais puis en espagnol : connexion, accueil, éditeur, lancement d'une partie avec un joueur dans un second onglet, grand écran, podium, rapport. Captures dans le compte rendu ; relever tout texte qui déborde (l'espagnol est plus long d'environ 20 %).
- [ ] Étape 3 : `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, tous propres.
- [ ] Étape 4 : mettre à jour le README (une phrase sur les langues disponibles et la façon d'en ajouter une : catalogue de zone, catalogue serveur, gabarits de courriel, quiz d'exemple). Commit `docs(i18n): langues disponibles`.
