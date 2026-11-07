# Envoi d'e-mails transactionnels : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengou envoie les e-mails d'invitation, de réinitialisation de mot de passe et de confirmation d'adresse, par SMTP ou par l'API Brevo, avec un repli sans configuration qui laisse l'application complète.

**Architecture:** Un nouveau paquet `@splootlabs/mail` porte l'interface `Mailer`, ses quatre transports, les gabarits et le contrôle des adresses. `packages/shared` valide la configuration et fournit la suggestion de domaine (partagée avec le web). `packages/auth` branche les hooks Better Auth ; `apps/server` injecte le mailer dans les routes ; `apps/web` ajoute les écrans et le bandeau.

**Tech Stack:** TypeScript, pnpm, Fastify 5, Better Auth 1.7.12, Drizzle (Postgres), React + react-router, Vitest, testcontainers, nodemailer, disposable-email-domains, Mailpit.

**Spec:** `docs/superpowers/specs/2026-11-04-envoi-email-design.md` (à lire avant chaque tâche ; ce plan ne répète pas les textes qu'elle fixe).

## Global Constraints

- Branche `feat/envoi-email`. Jamais `biome format --write` sur le dépôt. Commits conventionnels `type(portée): description` en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Aucun secret commité. Aucun token, lien d'action complet, clé API ou mot de passe SMTP dans les journaux ; on journalise le type de gabarit, le transport, le domaine du destinataire et le résultat.
- Toute valeur dynamique insérée dans le HTML passe par `escapeHtml`. Tous les liens sont absolus, bâtis sur `config.authUrl`.
- Textes visibles en français, sans tiret cadratin ni demi-cadratin, sans point médian ni écriture inclusive abrégée, apostrophe droite.
- Contraste au moins 4,5:1, régions `role="status"` ou `aria-live="polite"` pour les messages dynamiques, focus sur le résumé d'erreur (modèle de `apps/web/src/screens/Login.tsx`).
- La CI ne reçoit aucune variable de messagerie ; aucun test n'utilise le réseau (résolveur DNS et `fetch` injectés).
- Durées : réinitialisation 3600 s, confirmation 86400 s. Limites : 3 requêtes par 600 s et par IP sur `/request-password-reset` et `/send-verification-email` ; 20 créations ou renvois d'invitation par heure et par utilisateur.
- Délais réseau : SMTP et Brevo 10 s, DNS 3 s au total.

## Review Focus

- Nom d'affichage ou nom d'espace contenant `<`, `"`, `&` ou une URL : rendu échappé dans le HTML, texte brut intact dans la version texte (test dans la tâche 3).
- Adresse saisie avec majuscules ou espaces autour (`  Camille@Gmail.COM `) : le contrôle de domaine, la suggestion et la comparaison à l'acceptation d'invitation travaillent en minuscules sans espaces, sans toucher aux alias (tests dans les tâches 4 et 6).
- Brevo répond 401 (clé invalide) ou 403 (IP non autorisée) : `MailError` lisible dans le journal, sans la clé, et l'invitation reste créée avec `emailSent: false` (tests dans les tâches 2 et 6).
- Lien de réinitialisation déjà utilisé ou expiré ouvert sur mobile : écran « lien expiré » avec un lien vers une nouvelle demande, jamais une page blanche (test dans la tâche 8).
- Utilisateur non vérifié qui restaure un quiz archivé alors qu'il en a déjà un actif : refus 403 avec le code dédié (test dans la tâche 7).

---

### Task 1: Configuration de la messagerie

**Files:**
- Modify: `packages/shared/src/config.ts`
- Test: `packages/shared/src/config.test.ts`

**Interfaces:**
- Produces, exporté par `@splootlabs/shared` :

```ts
export type MailConfig =
  | { transport: 'none'; from?: string; replyTo?: string }
  | { transport: 'smtp'; from: string; replyTo?: string
      smtp: { host: string; port: number; user?: string; password?: string } }
  | { transport: 'brevo'; from: string; replyTo?: string; brevoApiKey: string }
// AppConfig gagne :
mail: MailConfig
emailDomainCheck: boolean   // 'auto' résolu : true si transport !== 'none'
```

- [ ] **Step 1: Écrire les tests qui échouent** dans `config.test.ts`, bloc `describe('messagerie')` :
  `sans MAIL_TRANSPORT → mail.transport === 'none' et emailDomainCheck === false` ;
  `MAIL_TRANSPORT=smtp + SMTP_HOST=mailpit + MAIL_FROM → smtp.port === 587` ;
  `smtp sans SMTP_HOST → throw /SMTP_HOST/` ; `brevo sans BREVO_API_KEY → throw /BREVO_API_KEY/` ;
  `transport choisi sans MAIL_FROM → throw /MAIL_FROM/` ; `SMTP_USER sans SMTP_PASSWORD → throw` (et l'inverse) ;
  `EMAIL_DOMAIN_CHECK=auto avec brevo → true`, `=false avec brevo → false`, `=true sans transport → true` ;
  `le message d'erreur ne contient jamais la valeur de SMTP_PASSWORD ni de BREVO_API_KEY` (passer `SMTP_PASSWORD='s3cr3t-valeur'` avec une autre erreur et vérifier `not.toContain('s3cr3t-valeur')`) ;
  `NODE_ENV=production sans transport → ne lève pas`.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/shared/src/config.test.ts`. Attendu : les nouveaux tests échouent.
- [ ] **Step 3: Implémenter.** Ajouter au schéma zod `MAIL_TRANSPORT: z.enum(['smtp','brevo']).optional()`, `MAIL_FROM`, `MAIL_REPLY_TO`, `SMTP_HOST`, `SMTP_PORT` (coerce, défaut 587), `SMTP_USER`, `SMTP_PASSWORD`, `BREVO_API_KEY`, `EMAIL_DOMAIN_CHECK: z.enum(['auto','true','false']).default('auto')`. Les contrôles croisés se font après `parse`, par des `throw new Error('Configuration invalide : …')` en français qui nomment la variable sans jamais citer sa valeur. Commenter chaque variable comme les voisines.
- [ ] **Step 4: Relancer le test.** Attendu : PASS, et `pnpm --filter @splootlabs/shared typecheck` sans erreur.
- [ ] **Step 5: Commit** `feat(config): variables de configuration de l'envoi d'e-mails`.

### Task 2: Paquet `@splootlabs/mail` et ses transports

**Files:**
- Create: `packages/mail/package.json`, `packages/mail/tsconfig.json` (copiés sur `packages/shared`, dépendances `nodemailer`, `@splootlabs/shared` ; dev `@types/nodemailer`)
- Create: `packages/mail/src/index.ts`, `packages/mail/src/mailer.ts`, `packages/mail/src/smtp.ts`, `packages/mail/src/brevo.ts`, `packages/mail/src/mask.ts`
- Test: `packages/mail/src/mailer.test.ts`, `packages/mail/src/brevo.test.ts`, `packages/mail/src/smtp.test.ts`

**Interfaces:**
- Consumes: `MailConfig` (tâche 1).
- Produces :

```ts
export type MailKind = 'invitation' | 'reset-password' | 'verify-email'
export type OutgoingMail = { to: string; subject: string; text: string; html: string; kind: MailKind }
export interface Mailer { readonly enabled: boolean; send(mail: OutgoingMail): Promise<void> }
export class MailError extends Error { constructor(message: string, readonly detail?: { status?: number; code?: string }) }
export type MailLogger = { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void }
export class MemoryMailer implements Mailer { enabled: boolean; sent: OutgoingMail[]; failNext(error?: Error): void; constructor(opts?: { enabled?: boolean }) }
export function createMailer(config: MailConfig, logger: MailLogger, opts?: { nodeEnv?: string; fetch?: typeof fetch }): Mailer
export function maskTokens(text: string): string   // toute suite de 20+ caractères [A-Za-z0-9_-] → 6 premiers + '…'
export function recipientDomain(email: string): string
```

`MemoryMailer` est activé par défaut (`enabled: true`) ; `failNext` fait échouer le prochain `send` puis revient à la normale.

- [ ] **Step 1: Tests qui échouent.**
  `mailer.test.ts` : `createMailer({transport:'none'})` renvoie un mailer `enabled === false` dont `send` journalise `{ kind, to domain, subject }` sans lever ; en `nodeEnv: 'development'` le journal contient le texte passé par `maskTokens`, en `production` il ne contient pas le texte ; `maskTokens('…/invitations/AbCdEf0123456789xyzQRS')` contient `AbCdEf…` et pas la suite.
  `brevo.test.ts` (fetch factice) : POST vers `https://api.brevo.com/v3/smtp/email`, en-tête `api-key`, corps `{ sender: { name: 'Pengou', email: 'contact@pengou.fr' }, to: [{ email }], replyTo: { email }, subject, htmlContent, textContent }` à partir de `from: 'Pengou <contact@pengou.fr>'` ; réponse 401 `{code:'unauthorized'}` → `MailError` avec `detail.status === 401` et un message qui ne contient pas la clé ; délai dépassé → `MailError`.
  `smtp.test.ts` : avec `nodemailer.createTransport({ jsonTransport: true })` injecté, l'enveloppe porte `from`, `replyTo`, `to`, `text` et `html` ; port 465 → `secure: true`, 587 → `secure: false, requireTLS: true` (tester la fonction `smtpTransportOptions(config)` exportée par `smtp.ts`).
- [ ] **Step 2: Lancer** `pnpm vitest run packages/mail`. Attendu : FAIL (module absent).
- [ ] **Step 3: Implémenter.** `parseAddress('Nom <a@b>')` dans `mailer.ts` pour Brevo. `BrevoMailer` utilise `opts.fetch ?? globalThis.fetch` et `AbortSignal.timeout(10_000)`. `SmtpMailer` : `connectionTimeout`, `greetingTimeout`, `socketTimeout` à 10 000. Enregistrer le paquet dans les références TypeScript comme les autres paquets si le dépôt en utilise, puis `pnpm install`.
- [ ] **Step 4: Relancer.** Attendu : PASS ; `pnpm --filter @splootlabs/mail typecheck` propre.
- [ ] **Step 5: Commit** `feat(mail): paquet d'envoi avec transports SMTP, Brevo, mémoire et journal`.

### Task 3: Gabarits des trois e-mails et logo

**Files:**
- Create: `packages/mail/src/templates/escape.ts`, `layout.ts`, `invitation.ts`, `reset-password.ts`, `verify-email.ts`
- Create: `apps/web/public/email/logo.png` (copie de `docs/pengou-logo-kit/png/logo-horizontal/couleur/pengou-logo-horizontal-couleur-h128.png`)
- Test: `packages/mail/src/templates/templates.test.ts`

**Interfaces:**
- Produces :

```ts
export function escapeHtml(value: string): string
export type RenderedMail = { subject: string; text: string; html: string }
export function invitationMail(d: { baseUrl: string; url: string; inviterName: string; workspaceName: string; role: 'admin' | 'member'; expiresAt: Date }): RenderedMail
export function resetPasswordMail(d: { baseUrl: string; url: string }): RenderedMail
export function verifyEmailMail(d: { baseUrl: string; url: string }): RenderedMail
```

`baseUrl` sert au logo (`${baseUrl}/email/logo.png`) et à valider que `url` commence par `baseUrl` (sinon `throw`). Rôle affiché : « membre » ou « administrateur ». Date en `fr-FR` (`11 novembre 2026`), fuseau `Europe/Paris`.

- [ ] **Step 1: Tests qui échouent.** Pour chaque gabarit : sujet exact de la spec (« Camille Martin vous invite sur Pengou », « Réinitialiser votre mot de passe Pengou », « Confirmez votre adresse e-mail Pengou ») ; `html` contient `lang="fr"`, `alt="Pengou"`, `role="presentation"`, un seul `<h1>`, le lien de l'action deux fois (bouton et lien de secours) ; `text` contient le lien et le titre ; `inviterName: '<script>alert(1)</script> & "Co"'` donne `&lt;script&gt;` et `&quot;` dans le HTML et la chaîne brute dans le texte ; `url` hors de `baseUrl` lève ; `expiresAt: new Date('2026-11-11T10:00:00Z')` donne « 11 novembre 2026 » ; aucun `·`, `—`, `–` dans le texte ni le HTML.
- [ ] **Step 2: Lancer** `pnpm vitest run packages/mail/src/templates`. Attendu : FAIL.
- [ ] **Step 3: Implémenter.** Chaînes de caractères avec styles en ligne, structure « Banquise claire » de la spec et de la maquette retenue (piste B : fond #EEF6FB, carte blanche bordée #d6e6ef, logo couleur 40 px, quatre formes décoratives `aria-hidden="true"` aux couleurs #5b4bd6, #ff9ec4, #007a99, #bdebf7, titre 23 px #0B2545, texte 16 px, bouton #0B2545 à texte blanc, petit texte #3d566b, pied #f6fafc), préentête masquée, largeur 560 px. Les quatre formes sont des cellules de tableau colorées de 22 px (carré, carré arrondi, rond par `border-radius`, losange par le caractère `◆` coloré), toutes dans un conteneur `aria-hidden="true"` : les bordures CSS en triangle et les rotations sont mal prises en charge par les clients de messagerie.
- [ ] **Step 4: Relancer.** Attendu : PASS.
- [ ] **Step 5: Commit** `feat(mail): gabarits français des e-mails d'invitation, de réinitialisation et de confirmation`.

### Task 4: Contrôle et suggestion d'adresse

**Files:**
- Create: `packages/mail/src/deliverability.ts` (dépendance `disposable-email-domains`)
- Create: `packages/shared/src/email-suggest.ts`, export dans `packages/shared/src/index.ts`
- Test: `packages/mail/src/deliverability.test.ts`, `packages/shared/src/email-suggest.test.ts`

**Interfaces:**
- Produces :

```ts
export type DnsResolver = { resolveMx(d: string): Promise<{ exchange: string; priority: number }[]>; resolve4(d: string): Promise<string[]>; resolve6(d: string): Promise<string[]> }
export type Deliverability = 'ok' | 'disposable' | 'undeliverable'
export function checkEmailDeliverable(email: string, opts: { dns: boolean; resolver?: DnsResolver; timeoutMs?: number; logger?: MailLogger }): Promise<Deliverability>
export const DELIVERABILITY_MESSAGES: Record<'disposable' | 'undeliverable', string>  // textes exacts de la spec
// shared :
export function suggestEmailDomain(email: string): string | null
```

- [ ] **Step 1: Tests qui échouent.** `deliverability` : `x@yopmail.com` et `x@sub.yopmail.com` → `disposable` (même avec `dns: false`) ; MX présent → `ok` ; pas de MX mais A présent → `ok` ; `ENOTFOUND` sur les trois → `undeliverable` ; MX nul (`exchange: ''` ou `'.'`) → `undeliverable` ; MX en `ETIMEOUT` → `ok` et un avertissement journalisé qui ne contient pas la partie locale ; résolveur qui ne répond jamais → `ok` après `timeoutMs` (10 ms en test) ; `'  Camille+pengou@Gmail.COM '` interrogé sur `gmail.com`.
  `suggestEmailDomain` : `camille@gmial.com` → `camille@gmail.com` ; `a@hotmial.fr` → `a@hotmail.fr` ; `a@gmail.con` → `a@gmail.com` ; `a@orange.fr` → `null` ; `Pre.Nom+x@gmal.com` → `Pre.Nom+x@gmail.com` (partie locale intacte) ; `a@exemple-ecole.fr` → `null` ; entrée sans `@` → `null`.
- [ ] **Step 2: Lancer** les deux fichiers. Attendu : FAIL.
- [ ] **Step 3: Implémenter.** Liste jetable chargée en `Set` au premier appel. Résolveur par défaut `node:dns/promises`. Suggestion : distance de Levenshtein au plus 2 sur la liste de domaines de la spec, puis correction d'extension (`.con`, `.cm`, `.fr.`, `.cmo` → `.com` ou `.fr`), jamais si le domaine est déjà dans la liste.
- [ ] **Step 4: Relancer.** Attendu : PASS.
- [ ] **Step 5: Commit** `feat(mail): refus des adresses jetables et suggestion de domaine`.

### Task 5: Better Auth et câblage du serveur

**Files:**
- Modify: `packages/auth/src/auth.ts`, `packages/auth/package.json` (dépendance `@splootlabs/mail`)
- Modify: `apps/server/src/index.ts`, `apps/server/src/editor.ts`, `apps/server/src/auth-plugin.ts`, `apps/server/package.json`
- Test: `apps/server/src/password-reset-e2e.test.ts`, `apps/server/src/email-verification-e2e.test.ts`, `packages/auth/src/auth.test.ts`

**Interfaces:**
- Consumes: `Mailer`, gabarits, `checkEmailDeliverable`, `DELIVERABILITY_MESSAGES`.
- Produces :

```ts
// AuthConfig gagne :
mailer?: Mailer                 // absent ou enabled=false : aucun hook d'envoi branché
emailDomainCheck?: boolean
resolver?: DnsResolver          // tests
rateLimitEnabled?: boolean      // force le limiteur (tests dédiés)
logger?: MailLogger
// registerEditor deps gagne : mailer: Mailer
// Nouvelle route : GET /api/auth-features → { mailEnabled: boolean }
```

- [ ] **Step 1: Tests e2e qui échouent** (modèle `auth-e2e.test.ts`, `MemoryMailer`, `TENANCY_MODE: 'multi'`).
  Réinitialisation : inscription ; `POST /api/auth/request-password-reset { email, redirectTo: '/reset-password' }` → 200 et un message `kind: 'reset-password'` dans `mailer.sent`, dont le texte contient `http://localhost:3000/api/auth/reset-password/` ; extraire le token ; `POST /api/auth/reset-password { newPassword, token }` → 200 ; connexion avec l'ancien mot de passe → refus, avec le nouveau → 200 ; même requête pour `inconnu@example.com` → même statut et même corps JSON, `mailer.sent` inchangé ; avec `rateLimitEnabled: true`, la 4e demande en 10 minutes → 429.
  Confirmation : l'inscription envoie `kind: 'verify-email'` ; ouvrir le lien (`GET` sur l'URL extraite, sans suivre la redirection) → 302 vers `/?email-verifie=1` ; `/api/me` renvoie `emailVerified: true`. `mailer.failNext()` avant l'inscription → inscription 200 malgré tout. Inscription `x@yopmail.com` → 400 avec le message « Les adresses e-mail jetables ne sont pas acceptées. » ; domaine sans MX ni A (résolveur factice) → 400 avec le message de domaine.
  `GET /api/auth-features` → `{ mailEnabled: true }` avec `MemoryMailer`, `false` avec `createMailer({transport:'none'})`, et le lien de réinitialisation n'est pas envoyé dans ce cas (`request-password-reset` ne plante pas).
- [ ] **Step 2: Lancer** `pnpm vitest run apps/server/src/password-reset-e2e.test.ts apps/server/src/email-verification-e2e.test.ts`. Attendu : FAIL.
- [ ] **Step 3: Implémenter dans `createAuth`.** Si `mailer?.enabled` : `emailAndPassword.sendResetPassword` (envoi non attendu, `.catch` journalisé), `resetPasswordTokenExpiresIn: 3600`, `revokeSessionsOnPasswordReset: true` ; `emailVerification: { sendOnSignUp: true, expiresIn: 86400, autoSignInAfterVerification: true, sendVerificationEmail }` avec `try/catch` journalisé. Toujours : `hooks.before` (`createAuthMiddleware` de `better-auth/api`) sur `ctx.path === '/sign-up/email'` qui appelle `checkEmailDeliverable` et lève `new APIError('BAD_REQUEST', { message })`. `rateLimit.enabled` vaut `rateLimitEnabled ?? (dev || prod)` et `customRules: { '/request-password-reset': { window: 600, max: 3 }, '/send-verification-email': { window: 600, max: 3 } }`. Vérifier dans `node_modules` le nom exact des options de la 1.7.12 avant d'écrire.
- [ ] **Step 4: Câbler le serveur.** `index.ts` : `const mailer = createMailer(config.mail, app.log, { nodeEnv: config.nodeEnv })`, avertissement unique si `!mailer.enabled && config.nodeEnv === 'production'` (texte de la spec), passer `mailer`, `emailDomainCheck`, `logger` à `createAuth` et `mailer` à `registerEditor`. Route `GET /api/auth-features` dans `auth-plugin.ts` (ou un petit fichier dédié), publique.
- [ ] **Step 5: Relancer** les e2e et `pnpm vitest run packages/auth apps/server/src/auth-e2e.test.ts`. Attendu : PASS, aucune régression.
- [ ] **Step 6: Commit** `feat(auth): réinitialisation du mot de passe et confirmation d'adresse par e-mail`.

### Task 6: Invitations envoyées par e-mail

**Files:**
- Modify: `packages/db/src/schema.ts` (colonne `emailedAt: timestamp('emailed_at', { withTimezone: true })`), migration générée par `pnpm --filter @splootlabs/db db:generate` (`packages/db/drizzle/0022_*.sql`, renommer en `0023_invitation_emailed_at.sql` si l'outil le permet via `--name`)
- Modify: `packages/db/src/repos/invitation.ts`, `apps/server/src/routes/invitations.ts`
- Test: `apps/server/src/invitations-email-e2e.test.ts`, test repo existant de `invitation` si présent

**Interfaces:**
- Consumes: `Mailer`, `invitationMail`, `checkEmailDeliverable`.
- Produces :

```ts
export async function markInvitationEmailed(scope: TenantScope, id: string, at: Date): Promise<void>
// resendInvitation remet emailedAt à null en plus du nouveau token.
// acceptInvitation(db, { token, userId, nowMs? }) : si inv.emailedAt non nul et
//   lower(trim(user.email)) === lower(trim(inv.email)), met user.emailVerified = true dans la même transaction.
// Réponses POST création / renvoi : { invitation, emailSent: boolean }
```

- [ ] **Step 1: Tests qui échouent.** Création → 201, `emailSent: true`, un message `kind: 'invitation'` dont le texte contient `http://localhost:3000/invitations/<token>`, le nom de l'invitant et le nom de l'espace ; `emailed_at` non nul en base. Renvoi → nouveau token dans le nouvel e-mail. `mailer.failNext()` → 201, `emailSent: false`, invitation listée, journal capturé sans le token. Mailer de repli → `emailSent: false`, comportement actuel inchangé. Invitation vers `x@yopmail.com` → 400. Acceptation par `Camille@Example.com ` d'une invitation e-mailée à `camille@example.com` → `emailVerified` vrai ; invitation jamais e-mailée → reste faux ; autre adresse → reste faux. Avec la limite active, la 21e création dans l'heure → 429.
- [ ] **Step 2: Lancer.** Attendu : FAIL.
- [ ] **Step 3: Implémenter.** Envoi attendu après l'enregistrement, `try/catch`, `markInvitationEmailed` seulement en cas de succès. Nom de l'invitant : `request.user.name` non vide, sinon son e-mail. Limite : option `config: { rateLimit: { max: 20, timeWindow: '1 hour', keyGenerator: (req) => req.user?.id ?? req.ip } }` sur les deux routes (vérifier que `requireUser` s'exécute avant le `keyGenerator` ; sinon clé par cookie de session haché). `deps` des routes gagne `mailer`.
- [ ] **Step 4: Relancer** ce fichier et les tests d'invitation existants. Attendu : PASS.
- [ ] **Step 5: Commit** `feat(invitations): envoi de l'invitation par e-mail et confirmation d'adresse à l'acceptation`.

### Task 7: Un seul quiz actif sans adresse confirmée

**Files:**
- Create: `apps/server/src/quiz-quota.ts`
- Modify: `apps/server/src/routes/quizzes.ts` (création, `restore`), `apps/server/src/routes/library.ts` (`duplicate`, `compose`)
- Test: `apps/server/src/quiz-quota.test.ts`, `apps/server/src/quiz-quota-e2e.test.ts`

**Interfaces:**
- Produces :

```ts
export const QUIZ_LIMIT_CODE = 'email_unverified_quiz_limit'
export function quizQuotaApplies(opts: { mailEnabled: boolean; tenancyMode: 'single' | 'multi'; emailVerified: boolean }): boolean
export async function assertCanOwnAnotherQuiz(systemDb: Db, user: { id: string; emailVerified: boolean }, opts: { mailEnabled: boolean; tenancyMode: 'single' | 'multi' }): Promise<null | { status: 403; body: { error: string; code: typeof QUIZ_LIMIT_CODE } }>
```

Comptage sur `systemDb` : quiz dont `owner_id = user.id` et `archived_at IS NULL`, tous tenants.

- [ ] **Step 1: Tests qui échouent.** Unitaires de `quizQuotaApplies` (vrai seulement pour `true, 'multi', false`). E2e en multi avec `MemoryMailer` : utilisateur non vérifié crée un premier quiz (201), le second → 403 `{ code: 'email_unverified_quiz_limit', error: "Confirmez votre adresse e-mail pour créer d'autres quiz." }` ; même refus pour la duplication et la composition depuis la bibliothèque ; archiver le premier puis en créer un autre → 201, puis restaurer l'archivé → 403 ; après `emailVerified = true` → 201 ; en `single` ou avec le mailer de repli → aucune limite.
- [ ] **Step 2: Lancer.** Attendu : FAIL.
- [ ] **Step 3: Implémenter** l'appel en tête de chaque route concernée (avant la transaction), `emailVerified` lu sur `request.user`.
- [ ] **Step 4: Relancer** ces tests et `routes-quizzes.test.ts`, `routes-library.test.ts`. Attendu : PASS.
- [ ] **Step 5: Commit** `feat(quiz): un seul quiz actif tant que l'adresse n'est pas confirmée`.

### Task 8: Écrans « Mot de passe oublié » et « Nouveau mot de passe »

**Files:**
- Create: `apps/web/src/screens/ForgotPassword.tsx`, `apps/web/src/screens/ResetPassword.tsx`, `apps/web/src/ui/EmailSuggestion.tsx`, `apps/web/src/api/features.ts`
- Modify: `apps/web/src/api/auth.tsx` (`User.emailVerified: boolean`, `requestPasswordReset`, `resetPassword`), `apps/web/src/api/client.ts` (`ApiError.code?: string`, lu depuis `body.code`), `apps/web/src/routes.tsx`, `apps/web/src/screens/Login.tsx`
- Test: `apps/web/src/screens/ForgotPassword.test.tsx`, `apps/web/src/screens/ResetPassword.test.tsx`

**Interfaces:**
- Produces :

```ts
export function useAuthFeatures(): { mailEnabled: boolean; loading: boolean }   // features.ts, un seul fetch mis en cache
export function requestPasswordReset(email: string): Promise<void>               // redirectTo: '/reset-password'
export function resetPassword(token: string, newPassword: string): Promise<void>
export function EmailSuggestion(props: { value: string; onApply(v: string): void }): JSX.Element | null
```

- [ ] **Step 1: Tests qui échouent.** `Login` affiche « Mot de passe oublié ? » seulement si `mailEnabled`. `ForgotPassword` : saisie `camille@gmial.com`, perte de focus → « Vouliez-vous dire camille@gmail.com ? » dans une région `aria-live="polite"`, clic sur la suggestion → champ corrigé ; envoi → message neutre exact de la spec dans `role="status"`, identique que l'API réponde 200 ou non. `ResetPassword` : sans token ou avec `?error=INVALID_TOKEN` → « Ce lien a expiré ou a déjà servi. » et un lien vers `/forgot-password` ; mots de passe différents → erreur sur le champ de confirmation ; succès → navigation vers `/login` avec un message de confirmation ; réponse 400 → même écran « lien expiré ».
- [ ] **Step 2: Lancer** `pnpm vitest run apps/web/src/screens/ForgotPassword.test.tsx apps/web/src/screens/ResetPassword.test.tsx`. Attendu : FAIL.
- [ ] **Step 3: Implémenter.** Routes publiques `/forgot-password` et `/reset-password` à côté de `/login`. Longueur minimale du mot de passe : la même que `Signup.tsx`.
- [ ] **Step 4: Relancer** ces tests et ceux de `Login` s'il en existe. Attendu : PASS.
- [ ] **Step 5: Commit** `feat(web): écrans de réinitialisation du mot de passe`.

### Task 9: Bandeau de confirmation, inscription et invitations côté web

**Files:**
- Create: `apps/web/src/ui/VerifyEmailBanner.tsx`
- Modify: `apps/web/src/AppShell.tsx`, `apps/web/src/screens/Signup.tsx`, `apps/web/src/screens/WorkspaceSettings.tsx`, `apps/web/src/api/auth.tsx` (`signUp` envoie `callbackURL: '/?email-verifie=1'`, `sendVerificationEmail()`), `apps/web/src/api/workspaces.ts` (`emailSent` dans les réponses), l'écran d'accueil ou l'`AppShell` pour `?email-verifie=1`, et les points d'appel qui créent un quiz (gestion de `ApiError.code === 'email_unverified_quiz_limit'`)
- Test: `apps/web/src/ui/VerifyEmailBanner.test.tsx`, tests existants de `Home`, `Library`

**Interfaces:**
- Consumes: `useAuthFeatures`, `EmailSuggestion`, `ApiError.code` (tâche 8).
- Produces: `export function sendVerificationEmail(): Promise<void>` (corps `{ email, callbackURL: '/?email-verifie=1' }`).

- [ ] **Step 1: Tests qui échouent.** Bandeau visible si `mailEnabled` et `emailVerified === false`, absent sinon ; texte « Confirmez votre adresse pour créer plus d'un quiz. » ; « Renvoyer l'e-mail » → appel puis « E-mail envoyé » dans `role="status"` ; fermeture mémorisée pour la session (`sessionStorage` dans un `try/catch`). `?email-verifie=1` → message « Adresse e-mail confirmée. » et rafraîchissement de la session. Création de quiz refusée avec le code dédié → message de la spec et bouton de renvoi sur place (dans `Home` et `Library`). `Signup` et le champ d'invitation de `WorkspaceSettings` affichent la suggestion de domaine. `WorkspaceSettings` : `emailSent: true` → « Invitation envoyée à camille@example.com » ; `emailSent: false` avec `mailEnabled` → « L'e-mail n'a pas pu partir, copiez le lien ci-dessous » ; sans `mailEnabled` → écran actuel inchangé ; le lien copiable reste présent dans tous les cas.
- [ ] **Step 2: Lancer.** Attendu : FAIL.
- [ ] **Step 3: Implémenter.** Style du bandeau : fond clair, texte #0b2545 ou équivalent à 4,5:1 minimum, bouton texte souligné, pas d'orange sur blanc pour du texte.
- [ ] **Step 4: Relancer** `pnpm vitest run apps/web`. Attendu : PASS.
- [ ] **Step 5: Commit** `feat(web): bandeau de confirmation d'adresse et invitations envoyées par e-mail`.

### Task 10: Mailpit, exemples d'environnement et documentation

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `docs/devops.md`, `README.md`

- [ ] **Step 1: Ajouter Mailpit.** Service `mailpit: image: axllent/mailpit:v1.27` (dernière version figée disponible au moment de l'implémentation, vérifier sur Docker Hub), `ports: ["8025:8025"]`, SMTP 1025 non publié. Service `app` : `MAIL_TRANSPORT: ${MAIL_TRANSPORT:-smtp}`, `SMTP_HOST: ${SMTP_HOST:-mailpit}`, `SMTP_PORT: ${SMTP_PORT:-1025}`, `MAIL_FROM: ${MAIL_FROM:-Pengou <contact@pengou.fr>}`, `BREVO_API_KEY: ${BREVO_API_KEY:-}`, et `depends_on: mailpit`. Commentaires dans le style du fichier.
- [ ] **Step 2: Vérifier** `docker compose config` (avec `BETTER_AUTH_SECRET` et `APP_DB_PASSWORD` factices dans l'environnement du shell) : sortie sans erreur, variables présentes. Si Docker est disponible : `docker compose up`, une demande de réinitialisation, l'e-mail visible sur http://localhost:8025, rendu vérifié à 375 px de large.
- [ ] **Step 3: Documenter.** `.env.example` : bloc commenté pour les trois cas (aucun, SMTP, Brevo) et `EMAIL_DOMAIN_CHECK`. `docs/devops.md` : section « Envoi d'e-mails » de la spec (variables, transports, Brevo en SMTP et en API, réglage des IP autorisées, comportement sans configuration, limite d'un quiz en mode multi, Mailpit). `README.md` : une ligne qui renvoie vers cette section.
- [ ] **Step 4: Vérification d'ensemble.** `pnpm typecheck`, `pnpm lint`, `pnpm test` : tout passe, sans variable de messagerie dans l'environnement.
- [ ] **Step 5: Commit** `docs(email): Mailpit en développement et documentation de l'envoi d'e-mails`.

### Task 11: Stack Pengou dans splootlabs-ops

**Files (dépôt `D:\Source\splootlabs-ops`, branche `feat/pengou-email` partant de `main` à jour):**
- Modify: `stacks/pengou/compose.yml`, `stacks/pengou/.env.example`

- [ ] **Step 1: Compose.** Ajouter à `x-app-env` les quatre lignes de la spec (`MAIL_TRANSPORT: brevo`, `MAIL_FROM: Pengou <contact@pengou.fr>`, `MAIL_REPLY_TO: contact@pengou.fr`, `BREVO_API_KEY: ${BREVO_API_KEY:?…}`), précédées d'un commentaire : transport de production, image antérieure qui ignore ces variables, service `migrate` concerné aussi. Mettre `MAIL_FROM` entre guillemets si le YAML l'exige (le `<` est sûr, mais vérifier avec `docker compose config`).
- [ ] **Step 2: `.env.example`.** Bloc `BREVO_API_KEY=` avec : Brevo, Paramètres, SMTP et API, onglet Clés API, « Générer une nouvelle clé », nom `pengou-prod` ; copier la clé une seule fois ; vérifier Sécurité, IP autorisées (ajouter l'IP du serveur ou désactiver le blocage) ; `chmod 600`.
- [ ] **Step 3: Vérifier** `tests/run.sh` : tous les tests bats passent. Et `IMAGE_TAG=0.0.0 BREVO_API_KEY=x … docker compose -f stacks/pengou/compose.yml config` sans erreur ; sans `BREVO_API_KEY`, échec avec le message prévu.
- [ ] **Step 4: Commit** `feat(pengou): envoi d'e-mails par l'API Brevo`. Le bump de `stacks/pengou/VERSION` se fait plus tard dans la même PR, via le skill `mise-en-production`, après la release Pengou et après l'ajout de la clé dans le `.env` du serveur. Ne rien pousser.
