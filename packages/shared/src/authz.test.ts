import { describe, it, expect } from 'vitest'
import { hasPermission, ROLE_CAPABILITIES, type Role, type Capability } from './authz.js'

describe('authz — catalogue de capacités', () => {
  it('owner et admin ont content:access-all ; member non', () => {
    expect(hasPermission('owner', 'content:access-all')).toBe(true)
    expect(hasPermission('admin', 'content:access-all')).toBe(true)
    expect(hasPermission('member', 'content:access-all')).toBe(false)
  })

  it('seul owner a workspace:manage ; owner+admin ont members:manage', () => {
    expect(hasPermission('owner', 'workspace:manage')).toBe(true)
    expect(hasPermission('admin', 'workspace:manage')).toBe(false)
    expect(hasPermission('owner', 'members:manage')).toBe(true)
    expect(hasPermission('admin', 'members:manage')).toBe(true)
    expect(hasPermission('member', 'members:manage')).toBe(false)
  })

  it("member n'a aucune capacité", () => {
    expect(ROLE_CAPABILITIES.member).toEqual([])
  })

  it('couverture exhaustive rôles × capacités', () => {
    const roles: Role[] = ['owner', 'admin', 'member']
    const caps: Capability[] = ['content:access-all', 'members:manage', 'workspace:manage']
    for (const r of roles)
      for (const c of caps) {
        expect(typeof hasPermission(r, c)).toBe('boolean')
      }
  })
})
