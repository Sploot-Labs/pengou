import { describe, expect, it } from 'vitest'
import { estCibleLocale, percentile, resumer } from './stats.mjs'

describe('percentile (rang le plus proche)', () => {
  it('renvoie NaN pour une liste vide', () => {
    expect(percentile([], 50)).toBeNaN()
  })

  it('renvoie la seule valeur pour une liste à un élément', () => {
    expect(percentile([42], 0)).toBe(42)
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 100)).toBe(42)
  })

  it('applique le rang le plus proche sur 1..10', () => {
    const v = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]
    expect(percentile(v, 50)).toBe(5)
    expect(percentile(v, 90)).toBe(9)
    expect(percentile(v, 95)).toBe(10)
    expect(percentile(v, 99)).toBe(10)
    expect(percentile(v, 100)).toBe(10)
    expect(percentile(v, 0)).toBe(1)
  })

  it('applique le rang le plus proche sur 1..100', () => {
    const v = Array.from({ length: 100 }, (_, i) => 100 - i)
    expect(percentile(v, 50)).toBe(50)
    expect(percentile(v, 95)).toBe(95)
    expect(percentile(v, 99)).toBe(99)
    expect(percentile(v, 99.5)).toBe(100)
  })

  it('ne modifie pas le tableau reçu', () => {
    const v = [3, 1, 2]
    percentile(v, 50)
    expect(v).toEqual([3, 1, 2])
  })
})

describe('resumer', () => {
  it('donne n, p50, p95, p99 et max arrondis au dixième', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1 + 0.04)
    expect(resumer(v)).toEqual({ n: 100, p50: 50, p95: 95, p99: 99, max: 100 })
  })

  it('arrondit au dixième le plus proche', () => {
    expect(resumer([1.26])).toEqual({ n: 1, p50: 1.3, p95: 1.3, p99: 1.3, max: 1.3 })
  })

  it('renvoie n = 0 et des NaN pour une liste vide', () => {
    const r = resumer([])
    expect(r.n).toBe(0)
    expect(r.p50).toBeNaN()
    expect(r.p95).toBeNaN()
    expect(r.p99).toBeNaN()
    expect(r.max).toBeNaN()
  })
})

describe('estCibleLocale', () => {
  it.each([
    'http://localhost:3000',
    'http://localhost',
    'https://localhost:8443/chemin',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'http://LOCALHOST:3000',
  ])('accepte %s', (url) => {
    expect(estCibleLocale(url)).toBe(true)
  })

  it.each([
    'https://example.org',
    'http://localhost.example.org',
    'http://127.0.0.2:3000',
    'http://10.0.0.1:3000',
    'http://0.0.0.0:3000',
    'localhost:3000',
    'pas une url',
    '',
  ])('refuse %s', (url) => {
    expect(estCibleLocale(url)).toBe(false)
  })
})
