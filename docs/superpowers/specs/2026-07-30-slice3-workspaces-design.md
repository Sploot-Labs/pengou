# Slice 3 — Workspaces bout-en-bout (multi-tenancy réelle)

Date : 2026-07-30
Branche : `feat/mt-slice3-workspaces` (worktree dédié, basé sur `master`)
Chantier : multi-tenancy réelle — capstone produit des Slices 0-2.

## Contexte vérifié dans le code (master, 2026-07-30)

Le socle sûr des Slices 0-2 est en place et confirmé :

- **Slice 0** : `tenant_id` NOT NULL + FK composite sur les tables enfants.
- **Slice 1** : catalogue de capacités `packages/shared/src/authz.ts`
  (`content:access-all`, `members:manage`, `workspace:manage`). Seul
  `content:access-all` est consommé. `members:manage`/`workspace:manage` sont
  **définis mais jamais lus**.
- **Slice 2** : RLS Postgres sur les 5 tables de CONTENU (`quiz`, `question`,
  `game_session`, `session_player`, `answer_record`). Deux rôles :
  `systemDb` (bypass RLS) + `appDb` (`app_role`, soumis au RLS). Contexte posé
  par `withTenantTx(appDb, {tenantId, ownerId}, fn)` (SET LOCAL `app.tenant_id`).
  `resolveTenantContext` (systemDb) résout tenant+rôle, les handlers enveloppent
  le travail dans `withTenantTx(appDb, …)`.

Manques confirmés (le mode multi n'est PAS utilisable) :

1. Hook signup (`packages/auth/src/auth.ts:49`) : ne crée tenant+membership
   **qu'en single**. Un signup en multi n'a **aucune** membership → aucun accès.
2. `resolveTenantId` (`packages/db/src/tenant.ts`) : en multi, **exige**
   l'en-tête `x-tenant-id` + une membership (sinon `TenantAccessDeniedError`).
3. **Aucun endpoint** de gestion de workspace (création, invitations, membres).
4. `requirePermission` / `members:manage` / `workspace:manage` : **jamais** lus.
5. Client (`apps/web/src/api/client.ts`) : n'envoie **jamais** `x-tenant-id`,
   pas de switcher.
6. `tenant`/`membership` : **PAS sous RLS** (`0015_rls.sql:12-13` = GRANT sans
   `ENABLE RLS`).
7. `tenant.name` : UNIQUE **global** (`schema.ts:14`).
8. **Bug découvert** : la socket `host:create` (`game-gateway.ts:678`) appelle
   `resolveTenantId(systemDb, config, { userId })` **sans** `explicitTenantId`.
   En multi ça **jette** → **lancer une partie est déjà cassé en mode multi**.

## Objectif

Rendre le mode multi réellement fonctionnel de bout en bout : créer un
workspace, inviter des membres, changer leurs rôles, basculer de workspace, et
câbler tout ça côté client — **sans casser le mode single** (défaut self-host).

## Décisions tranchées (défauts assumés, sans validation interactive)

L'utilisateur a demandé de tout livrer d'un coup sans questions. Les décisions
ouvertes du brief sont tranchées ainsi :

1. **Signup multi → workspace perso auto.** Au premier signup en multi, on crée
   un tenant personnel (slug dérivé de l'e-mail) + membership `owner`. Pas
   d'état vide « aucun workspace » : l'utilisateur a immédiatement un tenant
   fonctionnel, parité avec le single. Le hook `user.create.after` de Better
   Auth est étendu pour couvrir le multi.

2. **Nommage/unicité des workspaces.**
   - On **retire** l'UNIQUE global sur `tenant.name` (deux orgs « Acme » sont
     légitimes).
   - On **ajoute** `tenant.slug` : NOT NULL, **UNIQUE global**, URL-safe,
     auto-généré depuis le nom avec désambiguïsation numérique (`acme`,
     `acme-2`, …). `slug` est l'identifiant humain stable ; `tenant.id` (uuid)
     reste la valeur portée par `x-tenant-id` et le GUC RLS.
   - Le tenant `default` conserve le nom `default` et reçoit le slug `default`.

3. **Workspace actif : persistance client.** `localStorage` (clé
   `arena.activeTenantId`), défaut = 1re membership au login si absent/invalide.
   La **source de vérité par requête** reste l'en-tête `x-tenant-id` (HTTP) /
   `socket.handshake.auth.tenantId` (WS). Aucune colonne ajoutée à la table
   `user` (générée par Better Auth). `GET /api/me` renvoie les memberships pour
   que le client valide/choisisse.

4. **Invitations.** Table `invitation` (id, tenantId, email, role, token unique,
   invitedBy, status [`pending`/`accepted`/`revoked`], expiresAt, acceptedAt,
   createdAt).
   - Token : opaque URL-safe (`crypto.randomUUID()` sans tirets, 32 hex).
     Expiration **7 jours**.
   - Rôles invitables : `admin` | `member` **uniquement** (jamais `owner`).
   - Usage unique : accepter → status=`accepted` + membership créée.
   - Acceptation : endpoint par token, **exige un utilisateur authentifié**
     (existant, ou fraîchement inscrit qui accepte ensuite). Le token EST la
     capacité (bearer) — on n'exige pas la correspondance stricte de l'e-mail,
     mais on refuse si l'utilisateur est **déjà** membre. Renvoi (regénère
     token+expiration) et révocation (status=`revoked`) supportés.
   - Garde : `members:manage` (owner/admin) pour inviter/lister/renvoyer/révoquer.

5. **Gestion des membres + `requirePermission`.** Lister / changer de rôle /
   retirer, gardés par un nouveau preHandler `requirePermission(cap)` qui
   **consomme enfin** le catalogue de capacités. Gardes :
   - « au moins un owner » : impossible de rétrograder/retirer le dernier owner.
   - Seul un `owner` (`workspace:manage`) peut promouvoir quelqu'un vers `owner`
     (transfert d'ownership) ; un `admin` gère admin/member mais ne touche pas
     aux owners et ne crée pas d'owner.

6. **RLS sur `tenant`/`membership`.** On active RLS avec des policies clefées
   sur le GUC `app.tenant_id` (même motif que le contenu) :
   `tenant` USING `id = current_setting('app.tenant_id')::uuid` ;
   `membership` USING `tenant_id = current_setting('app.tenant_id')::uuid`.
   Ça sécurise les endpoints de gestion (appDb + `withTenantTx`). Les opérations
   **intrinsèquement pré-contexte** (résolution du tenant, « mes workspaces »,
   création de workspace, acceptation d'invitation par token) continuent de
   tourner sur `systemDb` (bypass RLS), gardées par leur propre auth (session +
   requête membership, ou token bearer) — ça résout l'œuf/poule.

7. **Flux joueur inchangé.** Les joueurs anonymes rejoignent par PIN **global** ;
   la résolution PIN→session et les events joueurs ne lisent jamais
   `x-tenant-id`. Le switcher n'affecte QUE les flux authentifiés hôte/éditeur
   (HTTP + `host:create`). `host:create` lira `socket.handshake.auth.tenantId`
   en multi (corrige le bug #8).

8. **Migration du tenant `default`.** Non destructive : `default` persiste (slug
   backfillé), ses memberships restent valides, les utilisateurs existants
   continuent sous `default`. Un passage single→multi ne migre aucun contenu ;
   les nouveaux signups multi obtiennent un workspace perso.

## Découpage (3 sous-slices, ordre 3a → 3b → 3c)

### 3a — Fondations multi (backend)
- Migration : `ADD COLUMN tenant.slug` (backfill des tenants existants incl.
  `default`, puis NOT NULL + UNIQUE), `DROP` UNIQUE sur `tenant.name`.
- Migration : table `invitation` + enum `invitation_status`.
- Migration : RLS `ENABLE` + policies sur `tenant` & `membership`.
- `packages/db` : `slugify`, `generateUniqueSlug`, `createWorkspace`,
  `listUserWorkspaces`, `getWorkspaceBySlug`. Mise à jour `schema.ts`.
- `packages/auth` : hook signup étendu au multi (workspace perso auto).
- Endpoints : `GET /api/workspaces`, `POST /api/workspaces`, `GET /api/me`
  étendu (`{ user, tenancyMode, memberships }`).

### 3b — Membres & invitations + `requirePermission` (backend)
- `apps/server` : preHandler `requirePermission(cap)` (résout le contexte via
  systemDb sur le `:tenantId` du path, vérifie `hasPermission`, 403 sinon).
- `packages/db` : repos `invitation` (create/list/getByToken/accept/revoke/
  resend) + gestion membership (listMembers, setMemberRole, removeMember,
  countOwners, garde ≥1 owner).
- Endpoints membres : `GET/PATCH/DELETE /api/workspaces/:tenantId/members[/:userId]`.
- Endpoints invitations : `POST/GET /api/workspaces/:tenantId/invitations`,
  `DELETE …/:id`, `POST …/:id/resend`, `GET /api/invitations/:token` (preview),
  `POST /api/invitations/:token/accept`.
- Fix socket `host:create` : lire `auth.tenantId` en multi.

### 3c — Client (frontend + transport)
- `apps/web/src/api/client.ts` : injecter `x-tenant-id` (depuis un petit store
  `activeTenant`) sur **toutes** les requêtes ; socket `io({ auth: { tenantId } })`.
- Switcher de workspace + « mes workspaces » (header), persistance localStorage,
  défaut = 1re membership. Affiché seulement si `tenancyMode === 'multi'`.
- Écran acceptation d'invitation (`/invitations/:token`).
- Écran gestion des membres/invitations d'un workspace (`/workspace`).

## Contrat d'API (résumé)

| Méthode | Route | Garde | Handle |
|---|---|---|---|
| GET | `/api/me` | requireUser | systemDb |
| GET | `/api/workspaces` | requireUser | systemDb |
| POST | `/api/workspaces` | requireUser (multi) | systemDb |
| GET | `/api/workspaces/:tenantId/members` | members:manage | appDb |
| PATCH | `/api/workspaces/:tenantId/members/:userId` | members:manage (+ gardes) | appDb |
| DELETE | `/api/workspaces/:tenantId/members/:userId` | members:manage (+ gardes) | appDb |
| GET | `/api/workspaces/:tenantId/invitations` | members:manage | appDb |
| POST | `/api/workspaces/:tenantId/invitations` | members:manage | appDb |
| POST | `/api/workspaces/:tenantId/invitations/:id/resend` | members:manage | appDb |
| DELETE | `/api/workspaces/:tenantId/invitations/:id` | members:manage | appDb |
| GET | `/api/invitations/:token` | requireUser | systemDb |
| POST | `/api/invitations/:token/accept` | requireUser | systemDb |

Promotion vers `owner` (transfert) : `PATCH members` exige en plus
`workspace:manage` (owner seul) quand le rôle cible est `owner`.

## Stratégie de test (TDD)

- Repos db : tests d'intégration `startTestDb` (systemDb pour la logique,
  `appDb` + `withTenantTx` pour prouver l'enforcement RLS tenant/membership).
- Endpoints : `app.inject` (comme `routes-quizzes.test.ts`), mode single ET
  multi (deux users, deux workspaces, tentative d'accès croisé → 403).
- Garde ≥1 owner : rétrograder/retirer le dernier owner → 409/400.
- Front : tests vitest (jsdom) sur l'injection `x-tenant-id` (client.ts) et le
  switcher.
- Non-régression single : la suite single existante doit rester verte.

## Hors scope

Facturation/plans réels, Stripe, multi-instance temps réel, e-mails réels
d'invitation (on renvoie le lien/token dans la réponse API ; l'envoi SMTP est un
branchement ultérieur).

## Gotchas (rappel chantier)

- Tests : `pnpm exec vitest run <pattern>` **depuis la racine** ; suite complète
  fiable avec `--fileParallelism=false`.
- Typecheck cross-package : `pnpm -r build` **avant** `pnpm -r typecheck`.
- Migrations : hand-written SQL + entrée `_journal.json` (précédent `0015_rls`).
- Travail concurrent `feat/audit-remediation` : construire sur `master`, résoudre
  au merge ; `pnpm install` si un test échoue sur « Failed to load url @fastify/… ».
