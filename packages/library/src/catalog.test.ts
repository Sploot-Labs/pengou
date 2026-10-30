import { describe, expect, it } from 'vitest'
import { BUILTIN_CATALOG_DIR, readCatalog } from './index.js'

describe('catalogue livré', () => {
  it('le catalogue livré se lit sans erreur', async () => {
    const snap = await readCatalog({ builtinDir: BUILTIN_CATALOG_DIR })
    expect(snap.quizzes.length).toBeGreaterThanOrEqual(1)
    expect(snap.rejectedFiles).toEqual([])
  })
})
