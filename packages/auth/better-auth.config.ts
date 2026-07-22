import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

// Instance "pour génération" : le CLI lit la config (adapter provider + plugins) pour émettre les tables Drizzle.
// Pas de vraie connexion DB requise ici.
export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
})
