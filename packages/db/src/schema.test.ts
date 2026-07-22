import { describe, it } from 'vitest'

// NOTE: Ce fichier de test dépend de `runMigrations` (Task 3, `./migrate.js`), qui n'existe pas
// encore à ce stade (Task 2). Les assertions sont donc différées via `describe.todo` pour garder
// `pnpm --filter @splootlabs/db test` vert. Elles seront activées lors de la Task 3 en important
// `startTestDb` + `runMigrations` et en exécutant les vraies requêtes contre Postgres.
describe.todo('schéma', () => {
  it('crée les 9 tables attendues', () => {})

  it("applique l'unicité du PIN uniquement aux sessions non terminées", () => {})
})
