import { describe, expect, it } from 'vitest'
import { isSpaRoute } from './spa-routes'

describe('isSpaRoute', () => {
  it.each([
    '/',
    '/login',
    '/signup',
    '/signup/',
    '/join',
    '/play',
    '/quizzes/abc-123',
    '/host/7f0c',
    '/sessions/7f0c/',
    '/invitations/jeton',
    '/screen/7f0c',
    '/credits',
    '/Join',
  ])('reconnaît %s', (path) => {
    expect(isSpaRoute(path)).toBe(true)
  })

  it.each([
    '',
    'join',
    '/zzz-unknown',
    '/robots.txt',
    '/sitemap.xml',
    '/favicon.ico',
    '/.well-known/security.txt',
    '/quizzes',
    '/quizzes/',
    '/quizzes//',
    '/quizzes/abc/edit',
    '/play/123456',
    '//join',
    '/join//',
  ])('refuse %s', (path) => {
    expect(isSpaRoute(path)).toBe(false)
  })
})
