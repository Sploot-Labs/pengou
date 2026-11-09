# Images dans les questions : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'auteur d'un quiz d'illustrer chaque question par une image facultative (fichier envoyé ou URL https collée, avec texte alternatif), affichée sur le grand écran, chez l'hôte et sur le téléphone des joueurs.

**Architecture:** La colonne `question.media` existe déjà et l'API la valide ; on ajoute `media_alt`, une route d'envoi `POST /api/media` qui écrit sur disque local (`MEDIA_DIR/<tenantId>/<uuid>.<ext>`) et un service statique en lecture sur `/uploads/`. Le moteur transporte `media`/`mediaAlt` de la ligne en base jusqu'aux projections `readingView` et `playerQuestionView`, en tolérant leur absence dans un état persisté ancien. Côté front, un champ d'édition dédié (`QuestionImageField`) branché sur la sauvegarde différée existante de l'éditeur, et un composant d'affichage unique (`QuestionImage`) qui disparaît proprement si l'image ne charge pas.

**Tech Stack:** TypeScript, Fastify 5 (`@fastify/multipart`, `@fastify/static`), Drizzle + Postgres (RLS), moteur `packages/game`, Socket.IO, React + Vite, Vitest + Testing Library (jsdom), Docker Compose.

## Décisions

Pas de spec écrite : les décisions ci-dessous, prises par le propriétaire du produit, en tiennent lieu.

1. Deux façons d'ajouter une image dans l'éditeur : envoyer un fichier, ou coller une URL https. Une image par question au plus, facultative, avec un texte alternatif (nouvelle colonne `media_alt`, 200 car. max) pour l'accessibilité.
2. Envoi : `POST /api/media` (utilisateur connecté avec le droit d'éditer des quiz dans le tenant actif), multipart via `@fastify/multipart`. Formats acceptés PNG, JPEG, WebP, GIF, vérifiés par les octets magiques et non par l'extension ou le Content-Type ; SVG refusé (risque XSS). Taille max 2 Mo. Pas de redimensionnement côté serveur (pas de dépendance native) ; le navigateur réduit l'image avant envoi si elle dépasse 1600 px de large, via un canvas.
3. Stockage sur disque local dans `MEDIA_DIR` (nouvelle variable, défaut raisonnable en dev), sous `<tenantId>/<uuid>.<ext>`, servi publiquement en lecture sur `/uploads/<tenantId>/<uuid>.<ext>` avec cache long et `X-Content-Type-Options: nosniff` (les joueurs n'ont pas de compte, la non-devinabilité de l'uuid suffit). Volume Docker dédié dans les deux fichiers compose et mention de la sauvegarde dans `docs/devops.md`. `isSafeMedia` continue d'accepter ces chemins relatifs.
4. Pas de ramasse-miettes des fichiers orphelins dans ce plan ; le noter comme non-objectif.
5. Affichage : l'image apparaît sur le grand écran et chez l'hôte dès la phase lecture, et sur le téléphone du joueur pendant la question (taille contenue, ne doit pas pousser les boutons de réponse hors de l'écran sur un téléphone de 360 px de large). Le moteur transporte `media` et `mediaAlt` dans `EngineQuestion` et les deux projections. Les rapports de session n'affichent pas l'image.
6. L'import CSV (`apps/server/src/csv.ts`) et la duplication de quiz, s'ils existent, doivent conserver `media` et `media_alt` ; vérifier et ajouter les tests nécessaires.

Constats faits en préparant ce plan, qui précisent les décisions :

- Décision 6 : il n'existe ni import CSV ni duplication de quiz sur cette branche. `apps/server/src/csv.ts` ne fait que de l'export de rapports (`toCsv`), et aucune route ni écran ne duplique un quiz. Les seuls chemins qui recréent une question à partir d'une autre sont internes à l'éditeur : le changement de type (suppression puis recréation, `draftForType`/`applyTypeChangeImmediate`) et l'annulation d'une suppression (`undoDelete`, via `toCreateInput`). Ce sont eux qui doivent conserver l'image (Task 7). Le catalogue de la Bibliothèque (branche `feat/bibliotheque-questions`, non fusionnée ici) insère aussi des questions : à reprendre lors de sa fusion.
- La couverture `cover` du quiz est validée côté serveur mais n'est éditée nulle part dans le front : il n'y a pas de modèle d'interface à copier, `QuestionImageField` est donc un composant neuf.
- Le droit « éditer des quiz dans le tenant actif » correspond, dans le code actuel, à tout membre du tenant résolu par `resolveContextOr403` (les `member` créent leurs propres quiz) : la route d'envoi utilise la même garde que `POST /api/quizzes`.

Non-objectifs : ramasse-miettes des fichiers orphelins (une image remplacée ou une question supprimée laisse son fichier sur disque) ; redimensionnement ou recompression côté serveur ; stockage objet (S3) ; image dans les rapports de session et dans les exports CSV ; image sur le téléphone du joueur pendant la phase lecture ; édition de la couverture du quiz.

## Global Constraints

- Une image par question au plus, facultative. `media_alt` : 200 caractères max (`LIMITS.mediaAlt = 200`).
- Formats acceptés à l'envoi : PNG, JPEG, WebP, GIF, détectés par octets magiques uniquement ; tout le reste (dont SVG) est refusé en 415.
- Taille max d'un envoi : 2 Mo, soit `MEDIA_MAX_BYTES = 2 * 1024 * 1024` (2 097 152 octets). Exactement 2 097 152 octets passe, 2 097 153 est refusé en 413.
- Réduction côté navigateur au-delà de `MAX_UPLOAD_WIDTH = 1600` px de large, en conservant le ratio. Aucune dépendance native côté serveur.
- Chemin disque `MEDIA_DIR/<tenantId>/<uuid>.<ext>`, URL publique `/uploads/<tenantId>/<uuid>.<ext>`, `ext` parmi `png`, `jpg`, `webp`, `gif`.
- Réponses de `/uploads/` : `Cache-Control: public, max-age=31536000, immutable` et `X-Content-Type-Options: nosniff`.
- Le dossier `apps/web/public/media/` reste réservé aux clips d'animation : rien n'y est écrit.
- L'éditeur n'accepte que les URL `https://` collées ; le serveur garde `isSafeMedia` inchangé (http(s) ou chemin relatif).
- Un état moteur persisté sans `media`/`mediaAlt` doit se réhydrater et produire `media: null, mediaAlt: null` dans les projections.
- Multi-tenant : l'envoi se fait dans le tenant résolu par `resolveContextOr403` (en-tête `x-tenant-id`), jamais dans un tenant passé dans le corps.
- Ne jamais lancer `biome format --write` sur ce dépôt.
- Typographie des textes destinés à l'utilisateur : pas de tiret cadratin ni demi-cadratin comme ponctuation, pas de gras d'emphase, apostrophe droite, guillemets « », pas de point médian, pas d'émoji.

## Review Focus

- Fichier renommé en `.png` (ou envoyé avec `Content-Type: image/png`) qui n'est pas une image, par exemple un SVG ou un HTML : le serveur doit répondre 415 sans rien écrire sur disque, quel que soit le nom ou le type annoncé. Testé en Task 3.
- Image de 2 Mo plus un octet : 413 avec un message lisible, aucun fichier partiel laissé dans `MEDIA_DIR` ; exactement 2 Mo passe. Testé en Task 3 ; le message est affiché dans l'éditeur (Task 7).
- URL `http://` collée dans l'éditeur : refusée avant tout appel réseau avec un message expliquant que seules les adresses https sont acceptées (la CSP `imgSrc` n'autorise que `https:`, l'image ne s'afficherait jamais). Testé en Task 7.
- Image distante qui ne charge pas pendant la partie (404, domaine mort, refus CSP) : le composant d'affichage disparaît, l'énoncé et les réponses restent affichés et utilisables. Testé en Task 8.
- Suppression de l'image d'une question existante : le PATCH envoie `media: null` et le texte alternatif est effacé avec elle, y compris côté serveur si le client n'envoie que `media: null`. Testé en Task 2 et Task 7.
- État moteur ancien sans `media` (partie en cours au moment du déploiement, réhydratée au boot) : les projections renvoient `media: null, mediaAlt: null` sans planter. Testé en Task 5.
- Chemin `/uploads/...` inexistant : 404, jamais le fallback SPA `index.html` en 200 (un `<img>` recevrait du HTML). Testé en Task 4.

---

### Task 1: Base de données, colonne `media_alt` et repo des questions

**Files:**
- Modify: `packages/db/src/schema.ts` (table `question`, après `media`)
- Create: `packages/db/drizzle/0024_question_media_alt.sql` et son entrée dans `packages/db/drizzle/meta/` (générés)
- Modify: `packages/db/src/repos/question.ts` (`CreateInput`, `createQuestion`, `updateQuestion`)
- Test: `packages/db/src/repos/question.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - colonne `question.media_alt text` nullable, champ Drizzle `mediaAlt: text('media_alt')` ; `Question` (inféré) gagne `mediaAlt: string | null`.
  - `createQuestion(scope, quizId, input: CreateInput)` avec `CreateInput.mediaAlt?: string | null` (défaut `null`).
  - `updateQuestion(scope, quizId, questionId, patch: Partial<{ prompt: string; timeLimit: number; readingTime: number; payload: unknown; media: string | null; mediaAlt: string | null }>)`.

- [ ] **Step 1: Écrire les tests en échec** dans `question.test.ts`, en réutilisant le montage existant du fichier (scope tenant + quiz).

```ts
it('createQuestion stocke media et mediaAlt', async () => {
  const q = await createQuestion(scope, quizId, { type: 'truefalse', prompt: 'P', timeLimit: 20, payload: { correct: true }, media: '/uploads/t/a.png', mediaAlt: 'Un manchot' })
  expect(q?.media).toBe('/uploads/t/a.png')
  expect(q?.mediaAlt).toBe('Un manchot')
})

it('createQuestion sans mediaAlt le laisse à null', async () => {
  const q = await createQuestion(scope, quizId, { type: 'truefalse', prompt: 'P', timeLimit: 20, payload: { correct: true } })
  expect(q?.mediaAlt).toBeNull()
})

it('updateQuestion peut effacer media et mediaAlt', async () => {
  const q = await createQuestion(scope, quizId, { type: 'truefalse', prompt: 'P', timeLimit: 20, payload: { correct: true }, media: 'https://exemple.org/a.png', mediaAlt: 'alt' })
  const u = await updateQuestion(scope, quizId, q!.id, { media: null, mediaAlt: null })
  expect(u?.media).toBeNull()
  expect(u?.mediaAlt).toBeNull()
})
```

- [ ] **Step 2: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/db test -- question.test.ts`
Expected: FAIL (erreur de type ou `mediaAlt` undefined).

- [ ] **Step 3: Ajouter `mediaAlt: text('media_alt')` au schéma puis générer la migration**

Run: `pnpm --filter @splootlabs/db db:generate --name question_media_alt`
Expected: un fichier `0024_question_media_alt.sql` contenant uniquement `ALTER TABLE "question" ADD COLUMN "media_alt" text;`. Les GRANT de `0015_rls.sql` sont posés au niveau table, aucune policy RLS n'est à modifier.

- [ ] **Step 4: Étendre `CreateInput` et le type de `patch` de `updateQuestion`** avec `mediaAlt`, insertion `mediaAlt: input.mediaAlt ?? null`.

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/db test`
Expected: PASS (y compris `migrate.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle packages/db/src/repos/question.ts packages/db/src/repos/question.test.ts
git commit -m "feat(db): texte alternatif de l'image d'une question"
```

### Task 2: API des questions, validation de `mediaAlt`

**Files:**
- Modify: `apps/server/src/validation.ts` (`LIMITS`)
- Modify: `apps/server/src/routes/questions.ts` (POST et PATCH)
- Test: `apps/server/src/routes-questions.test.ts`

**Interfaces:**
- Consumes: Task 1 (`createQuestion`/`updateQuestion` acceptent `mediaAlt`).
- Produces:
  - `LIMITS.mediaAlt = 200`.
  - `POST /api/quizzes/:quizId/questions` accepte `mediaAlt?: string` (chaîne vide ou blanche traitée comme absente).
  - `PATCH .../questions/:id` accepte `mediaAlt?: string | null`. Règle : si le corps contient `media: null` sans `mediaAlt`, le serveur pose aussi `mediaAlt = null`.
  - Erreurs 400 : `'mediaAlt doit être une chaîne ou null.'`, `'Le texte alternatif est trop long (200 caractères max).'`.

- [ ] **Step 1: Écrire les tests en échec** dans `routes-questions.test.ts` (helpers `buildApp`, `createQuizAndCookie`, `validMcq` déjà présents).

```ts
it('POST accepte media + mediaAlt et les renvoie', async () => {
  // POST { type: 'mcq', prompt: 'Q', timeLimit: 20, payload: validMcq, media: '/uploads/x/y.png', mediaAlt: 'Un manchot' }
  expect(res.statusCode).toBe(201)
  expect(res.json()).toMatchObject({ media: '/uploads/x/y.png', mediaAlt: 'Un manchot' })
})

it('POST refuse un mediaAlt de 201 caractères (400)', async () => {
  // mediaAlt: 'a'.repeat(201)
  expect(res.statusCode).toBe(400)
})

it('PATCH media: null efface aussi mediaAlt', async () => {
  // création avec media + mediaAlt, puis PATCH { media: null }
  expect(patched.json()).toMatchObject({ media: null, mediaAlt: null })
})

it('PATCH mediaAlt seul le met à jour sans toucher media', async () => {
  // PATCH { mediaAlt: 'Nouveau' }
  expect(patched.json()).toMatchObject({ media: '/uploads/x/y.png', mediaAlt: 'Nouveau' })
})

it('PATCH refuse un mediaAlt non chaîne (400)', async () => {
  // PATCH { mediaAlt: 42 }
  expect(res.statusCode).toBe(400)
})
```

- [ ] **Step 2: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/server test -- routes-questions.test.ts`
Expected: FAIL sur les cinq nouveaux tests.

- [ ] **Step 3: Implémenter** la validation dans les deux handlers, sur le modèle du champ `media` voisin (`tooLong(body.mediaAlt, LIMITS.mediaAlt)`), et la règle d'effacement couplé dans le PATCH.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/server test -- routes-questions.test.ts validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/validation.ts apps/server/src/routes/questions.ts apps/server/src/routes-questions.test.ts
git commit -m "feat(server): texte alternatif des images de question"
```

### Task 3: Envoi d'image, `POST /api/media`

**Files:**
- Modify: `packages/shared/src/config.ts` (`EnvSchema.MEDIA_DIR`, `AppConfig.mediaDir`)
- Test: `packages/shared/src/config.test.ts`
- Create: `apps/server/src/media-sniff.ts`
- Test: `apps/server/src/media-sniff.test.ts`
- Create: `apps/server/src/routes/media.ts`
- Modify: `apps/server/src/editor.ts` (enregistrement de la route)
- Modify: `apps/server/package.json` (`@fastify/multipart` `^9`)
- Test: `apps/server/src/routes-media.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `resolveContextOr403` (`require-user.ts`).
- Produces:
  - `AppConfig.mediaDir: string`, chemin absolu (`path.resolve` de `MEDIA_DIR`, défaut `./data/media`, déjà couvert par `data/` dans `.gitignore`).
  - `type ImageKind = 'png' | 'jpg' | 'webp' | 'gif'` et `sniffImageType(buf: Uint8Array): ImageKind | null` dans `media-sniff.ts`.
  - `MEDIA_MAX_BYTES = 2 * 1024 * 1024` exporté par `routes/media.ts`.
  - `registerMediaRoutes(app: FastifyInstance, deps: { systemDb: Db; config: AppConfig }): void`.
  - `POST /api/media`, multipart, un seul champ fichier nommé `file`. Réponses : 201 `{ url: '/uploads/<tenantId>/<uuid>.<ext>' }` ; 400 `'Aucun fichier reçu.'` ; 401 ; 403 ; 413 `'Image trop lourde (2 Mo max).'` ; 415 `'Format non pris en charge (PNG, JPEG, WebP ou GIF).'`.

- [ ] **Step 1: Écrire les tests en échec de `sniffImageType`**

```ts
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
it.each([
  ['png', PNG],
  ['jpg', [0xff, 0xd8, 0xff, 0xe0]],
  ['gif', [...Buffer.from('GIF89a')]],
  ['gif', [...Buffer.from('GIF87a')]],
  ['webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]],
])('reconnaît %s', (kind, bytes) => expect(sniffImageType(Uint8Array.from(bytes))).toBe(kind))

it('refuse un SVG même nommé .png', () => expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull())
it("refuse un RIFF qui n'est pas du WebP (WAV)", () => expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull())
it('refuse un tampon trop court', () => expect(sniffImageType(Uint8Array.from([0x89, 0x50]))).toBeNull())
```

- [ ] **Step 2: Écrire les tests en échec de la config** dans `config.test.ts` : sans `MEDIA_DIR`, `mediaDir` vaut `path.resolve('./data/media')` ; avec `MEDIA_DIR: '/srv/media'`, il vaut `path.resolve('/srv/media')`.

- [ ] **Step 3: Écrire les tests en échec de la route** dans `routes-media.test.ts`, montage calqué sur `routes-questions.test.ts` (`startTestDb`, `signUp`, `buildApp`) avec `loadConfig({ NODE_ENV: 'test', TENANCY_MODE: 'single', MEDIA_DIR: tmp })` où `tmp = mkdtempSync(join(tmpdir(), 'media-'))`. Corps multipart construit sans dépendance :

```ts
async function multipart(bytes: Uint8Array, filename: string, type = 'image/png') {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), filename)
  const req = new Request('http://local', { method: 'POST', body: form })
  return { payload: Buffer.from(await req.arrayBuffer()), contentType: req.headers.get('content-type')! }
}
```

Tests (une image PNG valide = en-tête `PNG` complété de zéros jusqu'à la taille voulue) :

```ts
it('201 : PNG valide écrit sous <tenantId>/<uuid>.png', async () => {
  expect(res.statusCode).toBe(201)
  const { url } = res.json() as { url: string }
  expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/)
  expect(existsSync(join(tmp, url.replace('/uploads/', '')))).toBe(true)
})
it('extension déduite des octets : un JPEG nommé photo.png est stocké en .jpg', ...)
it('415 : SVG renommé photo.png avec Content-Type image/png, rien écrit sur disque', ...)
it('415 : fichier texte quelconque', ...)
it('201 : exactement MEDIA_MAX_BYTES octets', ...)
it('413 : MEDIA_MAX_BYTES + 1 octets, rien écrit sur disque', ...)
it('400 : requête multipart sans champ fichier', ...)
it('401 : sans cookie de session', ...)
```

« Rien écrit sur disque » se vérifie en comparant la liste récursive des fichiers de `tmp` avant et après la requête.

- [ ] **Step 4: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/shared test -- config.test.ts` puis `pnpm --filter @splootlabs/server test -- media-sniff.test.ts routes-media.test.ts`
Expected: FAIL (modules et champ `mediaDir` absents).

- [ ] **Step 5: Implémenter**

`pnpm --filter @splootlabs/server add @fastify/multipart@^9`. Dans `registerMediaRoutes` : `app.register(multipart, { limits: { fileSize: MEDIA_MAX_BYTES, files: 1 } })`, route `POST /api/media` avec `preHandler: requireUser`, contexte via `resolveContextOr403`, `await request.file()`, `await data.toBuffer()` (l'erreur `FST_REQ_FILE_TOO_LARGE` devient 413), `sniffImageType` sur le tampon complet, puis `mkdir(join(mediaDir, tenantId), { recursive: true })` et `writeFile(..., { flag: 'wx' })` seulement une fois toutes les vérifications passées. Le nom de fichier envoyé par le client et son Content-Type ne sont jamais utilisés. La route reste sous le rate limit global. Appeler `registerMediaRoutes` depuis `registerEditor`.

- [ ] **Step 6: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/shared test && pnpm --filter @splootlabs/server test -- media-sniff.test.ts routes-media.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src apps/server/package.json pnpm-lock.yaml apps/server/src/media-sniff.ts apps/server/src/media-sniff.test.ts apps/server/src/routes/media.ts apps/server/src/editor.ts apps/server/src/routes-media.test.ts
git commit -m "feat(server): envoi d'images de question"
```

### Task 4: Service des images envoyées et déploiement

**Files:**
- Create: `apps/server/src/uploads.ts`
- Modify: `apps/server/src/editor.ts` (enregistrement)
- Modify: `apps/server/src/static.ts` (pas de fallback SPA sous `/uploads`)
- Test: `apps/server/src/uploads.test.ts`, `apps/server/src/static.test.ts`
- Modify: `apps/web/vite.config.ts` (proxy `/uploads` en dev)
- Modify: `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `docs/devops.md`

**Interfaces:**
- Consumes: `AppConfig.mediaDir` (Task 3).
- Produces: `registerUploads(app: FastifyInstance, mediaDir: string): void`, qui crée `mediaDir` s'il manque et sert `GET /uploads/*` en lecture seule.

- [ ] **Step 1: Écrire les tests en échec** dans `uploads.test.ts` (dossier temporaire contenant `t1/abc.png` avec un en-tête PNG) et `static.test.ts`.

```ts
it('sert un fichier envoyé avec cache long et nosniff', async () => {
  const res = await app.inject({ method: 'GET', url: '/uploads/t1/abc.png' })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toBe('image/png')
  expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  expect(res.headers['x-content-type-options']).toBe('nosniff')
})
it('404 sur un fichier absent', ...)                       // /uploads/t1/absent.png
it('refuse la traversée de répertoire', ...)               // /uploads/..%2f..%2fpackage.json → 403 ou 404, jamais 200
it('pas de listing de dossier', ...)                       // /uploads/t1/ → 404
// static.test.ts, avec registerStatic ET registerUploads montés :
it('ne fait pas de fallback SPA sous /uploads (404, pas index.html)', ...)
```

- [ ] **Step 2: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/server test -- uploads.test.ts static.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter `registerUploads`** avec une seconde instance de `@fastify/static` : `root: mediaDir`, `prefix: '/uploads/'`, `decorateReply: false`, `index: false`, `list: false`, `dotfiles: 'deny'`, `setHeaders` qui pose les deux en-têtes des Global Constraints. L'appeler depuis `registerEditor` juste après `registerMediaRoutes`. Dans `static.ts`, ajouter `/uploads` à la liste des préfixes qui répondent 404 JSON.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/server test`
Expected: PASS (suite serveur complète, pour détecter un conflit de décorateurs entre les deux `@fastify/static`).

- [ ] **Step 5: Déploiement**

`vite.config.ts` : entrée `'/uploads': { target: 'http://localhost:3000', changeOrigin: false }`. `Dockerfile`, étape runtime, avant `USER node` : `ENV MEDIA_DIR=/app/data/media` et `RUN mkdir -p /app/data/media && chown -R node:node /app/data` (le volume nommé hérite de ce propriétaire à sa création, sinon l'utilisateur `node` ne peut pas écrire). Les deux fichiers compose : volume `media-data:/app/data/media` sur le service `app`, déclaré dans `volumes:`. `docs/devops.md`, section 6 : un paragraphe sur le volume `media-data` (contient les images envoyées, à sauvegarder avec la base, par exemple `docker run --rm -v <projet>_media-data:/data -v "$PWD":/backup alpine tar czf /backup/media.tgz -C /data .`), et le rappel que les fichiers orphelins ne sont pas nettoyés.

- [ ] **Step 6: Vérifier la configuration compose**

Run: `BETTER_AUTH_SECRET=x docker compose -f docker-compose.yml config --quiet && IMAGE_TAG=0 POSTGRES_PASSWORD=x SESSION_SECRET=x BETTER_AUTH_SECRET=x BETTER_AUTH_URL=https://x docker compose -f docker-compose.prod.yml config --quiet`
Expected: aucune sortie, code 0. Si Docker est absent du poste, le noter dans le rapport de tâche.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/uploads.ts apps/server/src/uploads.test.ts apps/server/src/editor.ts apps/server/src/static.ts apps/server/src/static.test.ts apps/web/vite.config.ts Dockerfile docker-compose.yml docker-compose.prod.yml docs/devops.md
git commit -m "feat(server): service des images envoyées et volume Docker dédié"
```

### Task 5: Moteur et passerelle, transport de `media` et `mediaAlt`

**Files:**
- Modify: `packages/game/src/state.ts` (`EngineQuestion`)
- Modify: `packages/game/src/engine.ts` (`PlayerQuestionView`, `ReadingView`, `playerQuestionView`, `readingView`)
- Test: `packages/game/src/engine.test.ts`
- Modify: `apps/server/src/game-gateway.ts` (`toEngineQuestion`)
- Test: `apps/server/src/game-gateway.test.ts`

**Interfaces:**
- Consumes: colonne `mediaAlt` (Task 1) présente dans les lignes de `listQuestions`.
- Produces:
  - `EngineQuestion.media?: string | null` et `EngineQuestion.mediaAlt?: string | null` (optionnels pour les états persistés anciens).
  - `PlayerQuestionView` (non nul) et `ReadingView` gagnent `media: string | null; mediaAlt: string | null`, toujours présents, `?? null` sur l'état.
  - Sur le fil : `question:reading` et `question:show` portent `media` et `mediaAlt`.

- [ ] **Step 1: Écrire les tests en échec** dans `engine.test.ts`, à partir de `readingQuestion` et `mcqQuestion` existants.

```ts
it('readingView et playerQuestionView transportent media et mediaAlt', () => {
  // session avec { ...readingQuestion, media: '/uploads/t/a.png', mediaAlt: 'Un manchot' }
  expect(engine.readingView(s)).toMatchObject({ media: '/uploads/t/a.png', mediaAlt: 'Un manchot' })
  // après passage en phase question
  expect(engine.playerQuestionView(s)).toMatchObject({ media: '/uploads/t/a.png', mediaAlt: 'Un manchot' })
})

it('état ancien sans media : les projections renvoient null', () => {
  // question construite sans les clés media/mediaAlt (comme un JSON persisté avant cette version)
  expect(engine.readingView(s)).toMatchObject({ media: null, mediaAlt: null })
  expect(engine.playerQuestionView(s)).toMatchObject({ media: null, mediaAlt: null })
})
```

Dans `game-gateway.test.ts`, un test bout en bout : `setupHostedSession` puis PATCH de la question avec `{ media: '/uploads/x/y.png', mediaAlt: 'alt' }` avant `host:start` (ou création directe avec ces champs), joueur rejoint, `host:start`, puis `waitFor(player, 'question:show')` contient `media: '/uploads/x/y.png', mediaAlt: 'alt'`. Même vérification sur `question:reading` via `setupHostedSessionWithReading`.

- [ ] **Step 2: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/game test && pnpm --filter @splootlabs/server test -- game-gateway.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter** les deux champs optionnels sur `EngineQuestion`, les deux champs non optionnels sur les projections, et le recopiage dans `toEngineQuestion` (élargir le type de son paramètre à `media: string | null; mediaAlt: string | null`). Aucune logique de réhydratation dédiée : le `?? null` des projections suffit.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/game test && pnpm --filter @splootlabs/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game/src apps/server/src/game-gateway.ts apps/server/src/game-gateway.test.ts
git commit -m "feat(game): image de la question dans les projections lecture et question"
```

### Task 6: Front, client d'envoi et réduction des images

**Files:**
- Modify: `apps/web/src/api/client.ts` (`apiPostForm`)
- Test: `apps/web/src/api/client.test.ts`
- Create: `apps/web/src/api/media.ts`
- Modify: `apps/web/src/api/quizzes.ts` (types `Question`, `CreateQuestionInput`, `UpdateQuestionInput`)
- Create: `apps/web/src/media/downscale.ts`
- Test: `apps/web/src/media/downscale.test.ts`

**Interfaces:**
- Consumes: `POST /api/media` (Task 3).
- Produces:
  - `apiPostForm<T>(path: string, form: FormData): Promise<T>` : même gestion d'erreur et même en-tête `x-tenant-id` que `request`, sans `Content-Type` (le navigateur pose la frontière multipart).
  - `uploadMedia(file: Blob, filename: string): Promise<{ url: string }>` dans `api/media.ts`.
  - Types : `Question.mediaAlt: string | null` ; `CreateQuestionInput.media?: string | null`, `CreateQuestionInput.mediaAlt?: string | null` ; `UpdateQuestionInput.mediaAlt?: string | null`.
  - `MAX_UPLOAD_WIDTH = 1600`, `UPLOAD_MAX_BYTES = 2 * 1024 * 1024`.
  - `targetSize(width: number, height: number, maxWidth: number): { width: number; height: number }` (pure).
  - `prepareImageForUpload(file: File): Promise<Blob>` : renvoie le fichier tel quel si sa largeur est inférieure ou égale à 1600 px ou si c'est un GIF (le canvas aplatirait l'animation) ; sinon le redessine via `createImageBitmap` + canvas à `targetSize`, au même type MIME (JPEG et WebP en qualité 0,85).

- [ ] **Step 1: Écrire les tests en échec**

```ts
// downscale.test.ts
it('ne touche pas une image de 1600 px', () => expect(targetSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900 }))
it('réduit 3200x1800 en 1600x900', () => expect(targetSize(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 }))
it('arrondit la hauteur', () => expect(targetSize(4000, 3001, 1600)).toEqual({ width: 1600, height: 1200 }))

// client.test.ts (fetch mocké comme les tests voisins)
it('apiPostForm envoie le FormData tel quel, sans Content-Type, avec x-tenant-id', async () => {
  // setActiveTenantId('t1') ; apiPostForm('/api/media', form)
  expect(init.body).toBe(form)
  expect(init.headers?.['Content-Type']).toBeUndefined()
  expect(init.headers?.['x-tenant-id']).toBe('t1')
})
it('apiPostForm lève ApiError avec le message serveur sur 413', ...)
```

`prepareImageForUpload` dépend du canvas, absent de jsdom : il n'a pas de test unitaire, il est vérifié à la main en Task 7.

- [ ] **Step 2: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/web test -- downscale.test.ts client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter** `apiPostForm` en factorisant la construction des en-têtes et le traitement de la réponse avec `request` (pas de duplication de `extractErrorMessage`), puis `uploadMedia`, les types et `downscale.ts`.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/web test && pnpm --filter @splootlabs/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api apps/web/src/media
git commit -m "feat(web): client d'envoi et réduction des images"
```

### Task 7: Éditeur, champ image d'une question

**Files:**
- Create: `apps/web/src/screens/QuestionImageField.tsx`
- Test: `apps/web/src/screens/QuestionImageField.test.tsx`
- Modify: `apps/web/src/screens/HostEditor.tsx` (`QuestionBase`, `fromApiQuestion`, `toQuestionPatch`, `draftForType`, panneau de détail de la question)
- Test: `apps/web/src/screens/HostEditor.test.tsx`
- Modify: `apps/web/src/prototype.css` (styles du champ)

**Interfaces:**
- Consumes: `uploadMedia`, `prepareImageForUpload`, `UPLOAD_MAX_BYTES` (Task 6) ; `ApiError` (`api/client.ts`).
- Produces:
  - `parseImageUrl(input: string): { ok: true; url: string } | { ok: false; error: string }`, exportée par `QuestionImageField.tsx` : n'accepte que `https://` (via `new URL`), chaîne trimée.
  - `QuestionImageField(props: { media: string | null; mediaAlt: string | null; onChange: (patch: { media?: string | null; mediaAlt?: string | null }) => void; upload?: (file: File) => Promise<string> })`. `upload` par défaut : `prepareImageForUpload` puis `uploadMedia`, renvoie l'URL.
  - `QuestionBase` gagne `media: string | null; mediaAlt: string | null`, inclus dans `toQuestionPatch` (donc dans la sauvegarde différée existante et dans `toCreateInput`).

Textes d'interface fixés : légende « Image (facultative) » ; bouton « Envoyer une image » (input `type="file"` `accept="image/png,image/jpeg,image/webp,image/gif"`) ; champ « Ou coller l'adresse d'une image » + bouton « Utiliser » ; champ « Texte alternatif » (`maxLength={200}`) avec l'aide « Décrivez l'image pour les personnes qui ne la voient pas, sans donner la réponse. » ; bouton « Retirer l'image » ; erreurs : « Seules les adresses https sont acceptées. », « Adresse invalide. », « Image trop lourde, même après réduction (2 Mo max). », et pour un échec serveur, le message de l'`ApiError`. Pendant l'envoi, le bouton est désactivé et affiche « Envoi… ».

- [ ] **Step 1: Écrire les tests en échec** dans `QuestionImageField.test.tsx` (jsdom, `upload` injecté par `vi.fn`).

```ts
it('parseImageUrl refuse http', () => expect(parseImageUrl('http://exemple.org/a.png')).toEqual({ ok: false, error: 'Seules les adresses https sont acceptées.' }))
it('parseImageUrl refuse une adresse invalide', () => expect(parseImageUrl('pas une url').ok).toBe(false))
it('parseImageUrl accepte https et trime', () => expect(parseImageUrl('  https://exemple.org/a.png ')).toEqual({ ok: true, url: 'https://exemple.org/a.png' }))

it('URL http collée : message affiché, onChange jamais appelé', ...)
it('URL https collée : onChange({ media })', ...)
it('envoi de fichier : appelle upload puis onChange({ media: url })', ...)
it('échec 413 de upload : affiche le message serveur, onChange jamais appelé', ...)   // upload rejette new ApiError(413, 'Image trop lourde (2 Mo max).')
it("Retirer l'image : onChange({ media: null, mediaAlt: null })", ...)
it("affiche l'aperçu avec le texte alternatif quand media est présent", ...)       // getByRole('img', { name: 'Un manchot' })
```

Dans `HostEditor.test.tsx` (mocks `updateQuestion`/`createQuestion` existants, la fixture de question a déjà `media: null`, y ajouter `mediaAlt: null`) :

```ts
it("retirer l'image envoie un PATCH avec media et mediaAlt à null", ...)            // fixture media: '/uploads/t/a.png'
it("changer le type d'une question conserve son image", ...)                       // createQuestion appelé avec media et mediaAlt d'origine
it('annuler une suppression recrée la question avec son image', ...)
```

- [ ] **Step 2: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/web test -- QuestionImageField.test.tsx HostEditor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `QuestionImageField`**, avec vérification locale de `UPLOAD_MAX_BYTES` après `prepareImageForUpload` (pas d'appel réseau si trop lourd).

- [ ] **Step 4: Brancher dans `HostEditor`** : champs `media`/`mediaAlt` dans `QuestionBase`, `fromApiQuestion` et `toQuestionPatch` ; `draftForType` reprend `keep.media` et `keep.mediaAlt` ; `<QuestionImageField>` placé sous l'énoncé dans le panneau de détail, `onChange={updateSelected}`.

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `pnpm --filter @splootlabs/web test && pnpm --filter @splootlabs/web typecheck`
Expected: PASS.

- [ ] **Step 6: Vérification manuelle** (compétence `run`, serveur et Vite lancés) : envoyer un JPEG de plus de 1600 px et constater dans l'onglet réseau un envoi réduit à 1600 px de large ; envoyer un `.png` qui est en réalité un SVG et voir le message 415 ; recharger l'éditeur et retrouver l'image et son texte alternatif.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/screens/QuestionImageField.tsx apps/web/src/screens/QuestionImageField.test.tsx apps/web/src/screens/HostEditor.tsx apps/web/src/screens/HostEditor.test.tsx apps/web/src/prototype.css
git commit -m "feat(web): image d'une question dans l'éditeur"
```

### Task 8: Écrans de jeu, affichage de l'image

**Files:**
- Create: `apps/web/src/ui/QuestionImage.tsx`
- Test: `apps/web/src/ui/QuestionImage.test.tsx`
- Modify: `apps/web/src/realtime/contracts.ts` (`ReadingView`)
- Modify: `apps/web/src/screens/BigScreen.tsx`, `HostLive.tsx`, `PlayerLive.tsx` (types `QuestionShowPayload` locaux et rendu)
- Test: `apps/web/src/screens/BigScreen.motion.test.tsx`, `HostLive.reading.test.tsx`, `PlayerLive.reading.test.tsx`
- Modify: `apps/web/src/prototype.css`

**Interfaces:**
- Consumes: `media`/`mediaAlt` sur `question:reading` et `question:show` (Task 5).
- Produces:
  - `ReadingView` (contracts) et les trois `QuestionShowPayload` locaux gagnent `media?: string | null; mediaAlt?: string | null` (optionnels pour tolérer un flux ancien).
  - `QuestionImage(props: { src?: string | null; alt?: string | null; variant: 'big' | 'host' | 'player' })` : ne rend rien si `src` est vide ; rend `<img className="question-image question-image--<variant>" src alt={alt ?? ''} decoding="async">` ; sur `onError`, ne rend plus rien. L'état d'erreur est réinitialisé quand `src` change (clé `src` sur le composant chez l'appelant).

Placement : grand écran et hôte, sous l'énoncé en phase lecture et en phase question (y compris la révélation côté hôte) ; joueur, sous l'énoncé en phase question uniquement. CSS : `.question-image--player { max-height: 28vh; width: 100%; object-fit: contain; }`, `.question-image--big { max-height: 45vh; }`, `.question-image--host { max-height: 30vh; }`, tous `object-fit: contain` et `margin-inline: auto; display: block`.

- [ ] **Step 1: Écrire les tests en échec**

```ts
// QuestionImage.test.tsx
it('ne rend rien sans src', () => { render(<QuestionImage variant="player" />); expect(screen.queryByRole('img')).toBeNull() })
it("rend l'image avec son texte alternatif", ...)                  // getByRole('img', { name: 'Un manchot' })
it("disparaît si l'image ne charge pas", () => {
  render(<QuestionImage src="https://mort.example/a.png" alt="x" variant="big" />)
  fireEvent.error(screen.getByRole('img'))
  expect(screen.queryByRole('img')).toBeNull()
})

// PlayerLive.reading.test.tsx (emitServerEvent existant)
it("affiche l'image pendant la question, pas pendant la lecture", ...)
it("image en échec : l'énoncé et les boutons de réponse restent affichés", ...)   // fireEvent.error puis getAllByRole('button') non vide
// BigScreen.motion.test.tsx et HostLive.reading.test.tsx
it("affiche l'image dès la phase lecture", ...)
it("question:show sans media (flux ancien) : aucun img, pas d'erreur", ...)
```

- [ ] **Step 2: Lancer les tests et vérifier l'échec**

Run: `pnpm --filter @splootlabs/web test -- QuestionImage.test.tsx PlayerLive.reading.test.tsx BigScreen.motion.test.tsx HostLive.reading.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `QuestionImage`, les types et l'intégration dans les trois écrans, puis le CSS.**

- [ ] **Step 4: Lancer la suite complète**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: PASS, et le nombre de tests est supérieur aux 481 de départ.

- [ ] **Step 5: Vérification manuelle à 360 px** (compétence `run`, puis `chrome-devtools-mcp` `emulate` ou `resize_page` à 360x640) : une question QCM à quatre réponses avec une image portrait haute, côté joueur ; les quatre boutons de réponse sont visibles sans défilement. Recommencer avec une URL d'image morte : l'écran joueur et le grand écran restent lisibles, sans icône d'image cassée.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/QuestionImage.tsx apps/web/src/ui/QuestionImage.test.tsx apps/web/src/realtime/contracts.ts apps/web/src/screens apps/web/src/prototype.css
git commit -m "feat(web): image de la question sur les écrans de jeu"
```
