import { describe, it, expect, vi } from 'vitest'
import { loadConfig } from '@splootlabs/shared'
import { applyAppRolePassword } from './app-role.js'

describe('applyAppRolePassword', () => {
  it('pose le mot de passe APP_DB_PASSWORD quand le serveur dérive lui-même la connexion app_role', async () => {
    const setPassword = vi.fn(async () => {})
    await applyAppRolePassword(loadConfig({ NODE_ENV: 'test', APP_DB_PASSWORD: 'secret-app' }), setPassword)
    expect(setPassword).toHaveBeenCalledWith('secret-app')
  })

  it("ne touche pas au mot de passe quand APP_DATABASE_URL est fourni (rôle géré par l'exploitant)", async () => {
    const setPassword = vi.fn(async () => {})
    await applyAppRolePassword(
      loadConfig({ NODE_ENV: 'test', APP_DATABASE_URL: 'postgres://app_role:autre@db:5432/pengou' }),
      setPassword,
    )
    expect(setPassword).not.toHaveBeenCalled()
  })
})
