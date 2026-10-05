import 'reflect-metadata'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { CacheService } from '../../cache/cache.service'
import { validateEnvironment } from '../../config/environment'
import { CatalogueQueryDto, normalizeQuery } from '../catalogue.dto'

const input = {
  DATABASE_URL: 'postgresql://localhost/squad',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(64),
  CORS_ORIGINS: 'http://localhost:3000',
}
test('canonical query materializes defaults and normalizes only search and set ordering', () => {
  const first = Object.assign(new CatalogueQueryDto(), {
    search: '  GO  ',
    universe: ['B', 'A', 'B'],
    tags: ['human', 'melee', 'human'],
  })
  const second = Object.assign(new CatalogueQueryDto(), {
    search: 'go',
    universe: ['A', 'B'],
    tags: ['melee', 'human'],
  })
  assert.deepEqual(normalizeQuery(first), normalizeQuery(second))
  assert.deepEqual(normalizeQuery(new CatalogueQueryDto()), {
    page: 1,
    limit: 24,
    search: '',
    universe: [],
    tags: [],
    sort: 'source',
  })
  assert.deepEqual(
    normalizeQuery(Object.assign(new CatalogueQueryDto(), { tags: ['Human', 'human'] })).tags,
    ['Human', 'human'],
  )
})
test('cache keys separate every effective query field, revision, resource and response version', () => {
  // Key construction is pure; no network client is needed for this unit test.
  const cache = Object.create(CacheService.prototype) as CacheService
  Object.assign(cache, { config: new ConfigService(validateEnvironment(input)) })
  const query = normalizeQuery(new CatalogueQueryDto())
  const key = cache.key('1', 'characters', query)
  assert.match(key, /^catalog:v1:r1:characters:[a-f0-9]{64}$/)
  const changes = [
    { page: 2 },
    { limit: 25 },
    { search: 'a' },
    { universe: ['Mortal Kombat'] },
    { tags: ['human'] },
    { sort: 'name_asc' },
  ]
  for (const change of changes)
    assert.notEqual(key, cache.key('1', 'characters', { ...query, ...change }))
  assert.notEqual(key, cache.key('2', 'characters', query))
  assert.notEqual(key, cache.key('1', 'filters', query))
})
test('cache TTL, namespaces and dependency timeouts have validated bounded configuration', () => {
  const config = validateEnvironment(input)
  assert.equal(config.CACHE_TTL_SECONDS, 300)
  assert.equal(config.REDIS_TIMEOUT_MS, 200)
  assert.equal(config.HEALTH_TIMEOUT_MS, 1000)
  for (const invalid of [
    { CACHE_TTL_SECONDS: 0 },
    { CACHE_TTL_SECONDS: 86401 },
    { CACHE_NAMESPACE: '*' },
    { REDIS_TIMEOUT_MS: 0 },
    { REDIS_TIMEOUT_MS: 2001 },
    { HEALTH_TIMEOUT_MS: 5001 },
  ]) {
    assert.throws(
      () => validateEnvironment({ ...input, ...invalid }),
      /Invalid environment configuration/,
    )
  }
})
