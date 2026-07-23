# Hardening report — feat/hardening

Branch: `feat/hardening` (based on `master`, this worktree).

## Backlog status

1. `host:reconnect {sessionId}` — done. Re-binds host authority to a new socket after checking
   the Better Auth session against both the in-memory `session.hostId` and the persisted
   `game_session.host_id`.
2. Screen resilience — done via `screen:reconnect {sessionId, displayToken}`. `screen:join`
   keeps its single-use semantics for the *initial* take-over; the same (unguessable) token can
   be reused via `screen:reconnect` for the lifetime of the session.
3. Replay current question to latecomers — done. `player:join` and `screen:join` now emit
   `playerQuestionView` + `timer` to the joining socket when `phase === 'question'` (helper
   `replayCurrentQuestionTo`, shared with `player:reconnect`).
4. Real `host:skip` — done. New `doSkip` credits/persists answered rounds but never computes/
   emits `question:reveal`. Decision: skipped rounds are credited + persisted (players did
   answer), only the reveal broadcast is skipped.
5. `alreadyAnswered` flag — done. Included in the `player:reconnect` ack.
6. Slider `step` in `playerView` — done.
7. Socket.IO CORS — done. `origin: true` → allow-list driven by `AppConfig.authUrl` (+ dev
   localhost:5173 fallback outside production).
8. Dockerfile hardening — done. `HEALTHCHECK` via Node's global `fetch` against `/health`;
   runtime stage runs as `USER node`. Verified: image builds and `docker compose up`
   (`-p arena-hardening`) serves `/health`; stack torn down after.
9. Compose secret hygiene — done. `docker-compose.yml` now requires `BETTER_AUTH_SECRET` via
   `${BETTER_AUTH_SECRET:?...}` (no committed default) — `docker compose up`/`config` fails
   loudly with a clear message if unset. `.env.example` updated to match (commented out, no
   working placeholder).
10. Empty PATCH → 500 — done. `updateQuestion` with an empty patch is now a no-op returning the
    current row.
11. `reorderQuestions` non-permutations — done. Now requires an exact permutation of the quiz's
    question ids (rejects `[]` on a non-empty quiz, duplicates, partial lists).
12. Typed 403 — done. `TenantAccessDeniedError` exported from `@splootlabs/db`;
    `resolveScopeOr403` matches on `instanceof` instead of a French substring.

## Commits (chronological, oldest first)

- `98a98bc` feat(server): hardening temps réel — host:reconnect, screen:reconnect, latecomers, vrai host:skip, alreadyAnswered
- `02e5596` fix(db): patch vide en no-op, permutation stricte pour reorder, erreur 403 typée
- `ce8f6ff` fix(server): restreint le CORS Socket.IO à l'origine de l'app (plus de reflet universel)
- `f22ae8a` docs(server): corrige un commentaire obsolète (host:skip n'est plus un alias de host:reveal)
- `5b1748c` fix(docker): HEALTHCHECK + exécution non-root, secret Better Auth non committé

## Anti-cheat re-verification

`grep -n "emit(" apps/server/src/game-gateway.ts` — only `question:reveal` (built from
`engine.questionResult`) carries the correct answer; every `question:show` emission uses
`engine.playerQuestionView`.

## Verification (final)

- `pnpm -r build` — green (all 7 packages/apps + web).
- `pnpm -r typecheck` — green, no errors, across all packages.
- `pnpm test` — **33 test files, 229 tests, all passing** (baseline was ~212; net +17 from new
  hardening tests). No flakes hit on this run.
- `pnpm --filter @splootlabs/web build` — green (vite build, unchanged bundle size).
- Docker: `docker build` succeeded; `docker compose -p arena-hardening up -d --build` →
  `arena-hardening-app-1` reported `healthy`, `curl /health` returned
  `{"status":"ok","db":"up",...}`, `docker exec ... id` confirmed `uid=1000(node)`. Stack torn
  down with `docker compose -p arena-hardening down -v`; test images removed; no interference
  with the `arena-pg` container or the other stream's stack.
- `docker compose config` (no `BETTER_AUTH_SECRET` in env) fails immediately with the intended
  clear message; succeeds once the variable is set.
