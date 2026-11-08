import { describe, it, expect } from 'vitest'
import { quizQuotaApplies } from './quiz-quota.js'

describe('quizQuotaApplies', () => {
  it("ne s'applique que si envoi actif, mode multi et adresse non confirmée", () => {
    expect(quizQuotaApplies({ mailEnabled: true, tenancyMode: 'multi', emailVerified: false })).toBe(true)
    expect(quizQuotaApplies({ mailEnabled: false, tenancyMode: 'multi', emailVerified: false })).toBe(false)
    expect(quizQuotaApplies({ mailEnabled: true, tenancyMode: 'single', emailVerified: false })).toBe(false)
    expect(quizQuotaApplies({ mailEnabled: true, tenancyMode: 'multi', emailVerified: true })).toBe(false)
  })
})
