import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, connect, type Socket } from 'node:net'
import { test } from 'node:test'
import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DataSource } from 'typeorm'
import Redis from 'ioredis'
import { createDataSource, databaseUrl } from '../../database/data-source'
import { readSource } from '../../database/seed-source'
import { seedCatalogue } from '../../database/seed'
import { configureApp } from '../../configure-app'
import { CacheService } from '../../cache/cache.service'
import type { CharacterDto, CharacterPageDto, FiltersDto } from '../catalogue.dto'
import type { HealthDto } from '../../health/health.module'

// Test-owned TCP proxy forwards to real Redis, or deliberately stalls both directions.
// It never stops Redis, flushes keys or changes development connections.
async function proxy(target?: URL) {
  const sockets = new Set<Socket>()
  let stalled = !target
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    if (!target || stalled) return
    const upstream = connect(Number(target.port || 6379), target.hostname)
    sockets.add(upstream)
    upstream.on('error', () => socket.destroy())
    upstream.on('close', () => sockets.delete(upstream))
    socket.pipe(upstream).pipe(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    port: address.port,
    stall() {
      stalled = true
      for (const socket of sockets) socket.pause()
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
function mapped(character: CharacterDto): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    quote: character.quote ?? null,
    image: character.image,
    thumbnail: character.thumbnail ?? null,
    universe: character.universe,
    abilities: character.abilities,
    tags: character.tags ?? [],
  }
}

test(
  'catalogue/cache/health HTTP with isolated PostgreSQL and Redis namespace',
  { timeout: 120000 },
  async (t) => {
    if (process.env.NODE_ENV === 'production') throw new Error('Catalogue e2e refuses production')
    const raw = await readSource()
    const source = JSON.parse(raw.toString()) as CharacterDto[]
    const expected = source.map(mapped)
    const adminUrl = databaseUrl(process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL)
    const dbName = `squad_catalog_test_${randomUUID().replaceAll('-', '')}`
    const url = new URL(adminUrl)
    url.pathname = '/' + dbName
    const namespace = 'test_catalog_' + randomUUID().replaceAll('-', '')
    const redisUrl = new URL(
      process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    )
    assert.equal(
      redisUrl.protocol,
      'redis:',
      'Test TCP proxy requires a local non-TLS Redis service',
    )
    const redisProxy = await proxy(redisUrl)
    const stalledPostgres = await proxy()
    const proxiedRedis = new URL(redisUrl)
    proxiedRedis.hostname = '127.0.0.1'
    proxiedRedis.port = String(redisProxy.port)
    const overrides = {
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      REDIS_URL: proxiedRedis.toString(),
      CACHE_NAMESPACE: namespace,
      CACHE_TTL_SECONDS: '60',
      REDIS_TIMEOUT_MS: '100',
      HEALTH_TIMEOUT_MS: '150',
      JWT_SECRET: randomBytes(64).toString('hex'),
      CORS_ORIGINS: 'http://localhost:3000',
    }
    const original = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    )
    const admin = await createDataSource(adminUrl).initialize()
    const inspection = new Redis(redisUrl.toString(), {
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
    })
    inspection.on('error', () => {})
    let database: DataSource | undefined
    let app: INestApplication | undefined
    let created = false
    try {
      await admin.query(`CREATE DATABASE "${dbName}"`)
      created = true
      database = await createDataSource(url.toString()).initialize()
      const db = database
      await db.runMigrations()
      await seedCatalogue(db, raw)
      Object.assign(process.env, overrides)
      const { AppModule } = await import('../../app.module')
      app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
      configureApp(app)
      await app.listen(0, '127.0.0.1')
      const origin = await app.getUrl()
      const cache = app.get(CacheService)
      const config = app.get(ConfigService)
      // Wait for actual Redis ready, bounded and fail loudly rather than skipping integration checks.
      await new Promise<void>((resolve, reject) => {
        if (cache.client.status === 'ready') return resolve()
        const timer = setTimeout(() => reject(new Error('Test Redis did not become ready')), 3000)
        cache.client.once('ready', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      const request = async <T>(path: string): Promise<{ status: number; body: T }> => {
        const response = await fetch(origin + '/api/v1/' + path, {
          signal: AbortSignal.timeout(5000),
        })
        return { status: response.status, body: (await response.json()) as T }
      }
      const list = async (query = ''): Promise<CharacterPageDto> => {
        const result = await request<CharacterPageDto>('characters' + query)
        assert.equal(result.status, 200)
        return result.body
      }
      const filtersExpected: FiltersDto = {
        universes: [...new Set(source.map((c) => c.universe))].sort(),
        tags: [...new Set(source.flatMap((c) => (c.tags ?? []).map((tag) => tag.tag_name)))].sort(),
      }
      await t.test(
        'pagination discovers every source ID exactly once and maps every field',
        async () => {
          const all: CharacterDto[] = []
          for (let page = 1; page <= 9; page++) {
            const result = await list(`?page=${page}`)
            assert.deepEqual(result.meta, { page, limit: 24, total: 208, totalPages: 9 })
            all.push(...result.data)
          }
          assert.equal(new Set(all.map((c) => c.id)).size, 208)
          assert.deepEqual(all, expected)
          assert.deepEqual((await list('?page=1000000&limit=100')).data, [])
        },
      )
      await t.test(
        'static filters route returns complete metadata and missing fields normalize',
        async () => {
          const result = await request<FiltersDto>('characters/filters')
          assert.equal(result.status, 200)
          assert.deepEqual(result.body, filtersExpected)
          assert.ok(result.body.tags.includes('grapple') && result.body.tags.includes('grappling'))
          for (const id of [25, 31, 42]) {
            const character = await request<CharacterDto>('characters/' + id)
            assert.equal(character.status, 200)
            assert.deepEqual(
              character.body,
              expected.find((c) => c.id === id),
            )
          }
          assert.equal((await list('?universe=Mortal%20Kombat&limit=1')).meta.total, 37)
          assert.deepEqual((await request<FiltersDto>('characters/filters')).body, filtersExpected)
        },
      )
      await t.test(
        'combined universe OR/tag AND/literal search counts match independent source predicates',
        async () => {
          const combinations = [
            { search: 'a', universes: ['Mortal Kombat', 'Dragon Ball Z'], tags: [] },
            { search: '', universes: ['Street Fighter'], tags: ['melee'] },
            { search: 'r', universes: [], tags: ['melee', 'human'] },
            { search: 'a', universes: ['Super Smash Bros', 'Street Fighter'], tags: ['ranged'] },
          ]
          for (const combination of combinations) {
            const params = new URLSearchParams({ search: combination.search, limit: '100' })
            combination.universes.forEach((value) => params.append('universe', value))
            combination.tags.forEach((value) => params.append('tags', value))
            const matches = expected.filter(
              (c) =>
                c.name.toLowerCase().includes(combination.search) &&
                (!combination.universes.length || combination.universes.includes(c.universe)) &&
                combination.tags.every((tag) => c.tags.some((value) => value.tag_name === tag)),
            )
            const result = await list('?' + params)
            assert.equal(result.meta.total, matches.length)
            assert.deepEqual(result.data, matches.slice(0, 100))
          }
        },
      )
      await t.test(
        'name sorts are stable with ID tie-breaker and distinct cache entries',
        async () => {
          for (const sort of ['name_asc', 'name_desc'] as const) {
            const sorted = (await db.query(
              `SELECT id FROM characters ORDER BY lower(name) ${sort === 'name_asc' ? 'ASC' : 'DESC'}, id ASC`,
            )) as { id: number }[]
            const pages = [
              await list(`?sort=${sort}&limit=100`),
              await list(`?sort=${sort}&limit=100&page=2`),
              await list(`?sort=${sort}&limit=100&page=3`),
            ]
            assert.deepEqual(
              pages.flatMap((page) => page.data.map((c) => c.id)),
              sorted.map((row) => row.id),
            )
          }
        },
      )
      await t.test(
        'invalid params/IDs, unknown fields/filters and missing records have consistent errors',
        async () => {
          for (const path of [
            'characters?page=0',
            'characters?page=1000001',
            'characters?limit=101',
            'characters?page=1.5',
            'characters?page=1&page=2',
            'characters?limit=abc',
            'characters?sort=invalid',
            'characters?unknown=true',
            'characters?tags=unknown',
            'characters?universe=unknown',
            'characters?search=' + 'x'.repeat(201),
            'characters?tags[x]=y',
            'characters/-1',
            'characters/abc',
            'characters/0',
            'characters/2147483648',
          ]) {
            const response = await request<{ statusCode: number; error: string; message: string }>(
              path,
            )
            assert.equal(response.status, 400, path)
            assert.equal(response.body.statusCode, 400)
            assert.ok(['VALIDATION_ERROR', 'INVALID_FILTER'].includes(response.body.error))
            assert.ok(response.body.message)
          }
          const missing = await request<{ error: string; statusCode: number }>('characters/9999')
          assert.equal(missing.status, 404)
          assert.equal(missing.body.error, 'CHARACTER_NOT_FOUND')
          assert.equal(missing.body.statusCode, 404)
        },
      )
      await t.test(
        'normalized requests hit same entry, distinct effective filters/pages/limits stay separate; batched queries',
        async () => {
          const appDb = app!.get(DataSource)
          const sql: string[] = []
          const priorLog = appDb.logger.logQuery
          appDb.logger.logQuery = (query: string) => {
            sql.push(query)
          }
          try {
            const first = await list(
              '?search=%20GO%20&universe=Dragon%20Ball%20Z&universe=Mortal%20Kombat&limit=7',
            )
            assert.equal(
              sql.filter((q) => q.includes('FROM character_abilities')).length,
              first.data.length ? 1 : 0,
            )
            assert.equal(
              sql.filter((q) => q.includes('FROM character_tags WHERE')).length,
              first.data.length ? 1 : 0,
            )
            sql.length = 0
            const second = await list(
              '?universe=Mortal%20Kombat&universe=Dragon%20Ball%20Z&universe=Mortal%20Kombat&search=go&limit=7&page=1&sort=source',
            )
            assert.deepEqual(first, second)
            assert.equal(
              sql.filter((q) =>
                /FROM characters|FROM character_tags|FROM character_abilities/.test(q),
              ).length,
              0,
            )
            for (const query of [
              '?search=go&limit=7&page=2',
              '?search=go&limit=8',
              '?search=go&universe=Street%20Fighter',
              '?tags=ranged&limit=7',
              '?tags=melee&limit=7',
            ]) {
              const result = await list(query)
              const params = new URLSearchParams(query.slice(1))
              const matches = expected.filter(
                (c) =>
                  c.name.toLowerCase().includes(params.get('search') ?? '') &&
                  (!params.has('universe') || c.universe === params.get('universe')) &&
                  (!params.has('tags') ||
                    c.tags.some((tag) => tag.tag_name === params.get('tags'))),
              )
              assert.equal(result.meta.total, matches.length)
              assert.deepEqual(
                result.data,
                matches.slice(
                  (result.meta.page - 1) * result.meta.limit,
                  result.meta.page * result.meta.limit,
                ),
              )
            }
            const keys = await inspection.keys(namespace + ':*')
            assert.ok(keys.length > 10)
            assert.ok((await inspection.ttl(keys[0]!)) > 0)
          } finally {
            appDb.logger.logQuery = priorLog
          }
        },
      )
      await t.test('unchanged seed preserves revision and cached lists/metadata', async () => {
        const first = await list('?limit=73')
        const seeded = await seedCatalogue(db, raw)
        assert.equal(seeded.changed, false)
        assert.equal(seeded.revision, '1')
        assert.deepEqual(await list('?limit=73'), first)
        assert.ok(await inspection.exists(cache.key('1', 'filters')))
      })
      await t.test(
        'changed seed invalidates list/metadata, literal wildcard/punctuation search and tied names',
        async () => {
          const fixture = structuredClone(source)
          fixture[0]!.name = "Literal % _ \\ [test] O'Brien"
          fixture[0]!.universe = 'Fixture universe'
          fixture[0]!.tags = [{ slot: 3, tag_name: 'fixture-tag' }]
          fixture[1]!.name = fixture[0]!.name
          const changed = await seedCatalogue(db, Buffer.from(JSON.stringify(fixture)))
          assert.equal(changed.revision, '2')
          const metadata = (await request<FiltersDto>('characters/filters')).body
          assert.ok(metadata.universes.includes('Fixture universe'))
          assert.ok(metadata.tags.includes('fixture-tag'))
          assert.equal((await list('?limit=73')).data[0]?.name, fixture[0]!.name)
          for (const search of ['%', '_', '\\', '[test]', "O'Brien"]) {
            const matches = fixture.filter((c) =>
              c.name.toLowerCase().includes(search.toLowerCase()),
            )
            const result = await list('?limit=100&search=' + encodeURIComponent(search))
            assert.equal(result.meta.total, matches.length)
            assert.deepEqual(result.data, matches.map(mapped))
          }
          for (const sort of ['name_asc', 'name_desc']) {
            const result = await list('?search=Literal&sort=' + sort)
            assert.deepEqual(
              result.data.map((c) => c.id),
              [fixture[0]!.id, fixture[1]!.id].sort((a, b) => a - b),
            )
          }
          assert.ok(await inspection.exists(cache.key('1', 'filters')))
          assert.ok(await inspection.exists(cache.key('2', 'filters')))
          await seedCatalogue(db, raw)
        },
      )
      await t.test(
        'concurrent seed cannot mix response rows or relations with an older revision',
        async () => {
          const oldGet = cache.get.bind(cache)
          let release!: () => void
          let entered!: () => void
          const barrier = new Promise<void>((resolve) => {
            entered = resolve
          })
          const gate = new Promise<void>((resolve) => {
            release = resolve
          })
          let blocked = false
          cache.get = async <T>(key: string): Promise<T | undefined> => {
            if (!blocked && key.includes(':characters:')) {
              blocked = true
              entered()
              await gate
            }
            return oldGet<T>(key)
          }
          const pending = list('?limit=72')
          try {
            await barrier
            const fixture = structuredClone(source)
            fixture[0]!.name = 'Concurrent changed character'
            fixture[0]!.abilities[0]!.abilityScore =
              fixture[0]!.abilities[0]!.abilityScore === 10 ? 1 : 10
            fixture[0]!.tags = [{ slot: 2, tag_name: 'concurrent-fixture' }]
            const changed = await seedCatalogue(db, Buffer.from(JSON.stringify(fixture)))
            assert.equal(changed.revision, '4')
            release()
            assert.deepEqual((await pending).data, expected.slice(0, 72))
            const next = await list('?limit=72')
            assert.deepEqual(next.data, fixture.slice(0, 72).map(mapped))
          } finally {
            release()
            cache.get = oldGet
            await seedCatalogue(db, raw)
          }
        },
      )
      await t.test(
        'Swagger exposes public catalogue parameters, nullable mapping and health statuses',
        async () => {
          const response = await fetch(origin + '/api/docs-json')
          const spec = (await response.json()) as {
            paths: Record<
              string,
              {
                get: {
                  parameters?: { name: string; schema?: { type?: string } }[]
                  responses: Record<string, unknown>
                }
              }
            >
            components: {
              schemas: Record<
                string,
                { properties: Record<string, { nullable?: boolean; type?: string }> }
              >
            }
          }
          assert.equal(response.status, 200)
          const parameters = spec.paths['/api/v1/characters']!.get.parameters!.map((p) => p.name)
          for (const name of ['page', 'limit', 'search', 'universe', 'tags', 'sort'])
            assert.ok(parameters.includes(name))
          assert.ok(spec.paths['/api/v1/characters/filters'])
          assert.ok(spec.paths['/api/v1/characters/{id}']!.get.responses['404'])
          assert.ok(spec.paths['/api/v1/health']!.get.responses['503'])
          assert.ok(spec.paths['/api/v1/health']!.get.responses['403'])
          for (const name of ['page', 'limit'])
            assert.equal(
              spec.paths['/api/v1/characters']!.get.parameters!.find((p) => p.name === name)?.schema
                ?.type,
              'integer',
            )
          assert.equal(spec.components.schemas.CharacterDto!.properties.id?.type, 'integer')
          const denied = await fetch(origin + '/api/v1/health', {
            headers: { Origin: 'https://denied.example' },
          })
          assert.equal(denied.status, 403)
          assert.deepEqual(await denied.json(), {
            statusCode: 403,
            error: 'CORS_ORIGIN_DENIED',
            message: 'Origin is not allowed',
          })
          assert.equal(spec.components.schemas.CharacterDto!.properties.quote?.nullable, true)
        },
      )
      await t.test(
        'health probes both dependencies and detects a stalled PostgreSQL connection promptly',
        async () => {
          const healthy = await request<HealthDto>('health')
          assert.equal(healthy.status, 200)
          assert.deepEqual(healthy.body, {
            status: 'ok',
            dependencies: { postgres: 'up', redis: 'up' },
          })
          const failingUrl = new URL(url)
          failingUrl.port = String(stalledPostgres.port)
          failingUrl.hostname = '127.0.0.1'
          config.set('DATABASE_URL', failingUrl.toString())
          try {
            const start = performance.now()
            const down = await request<HealthDto>('health')
            assert.ok(performance.now() - start < 1500)
            assert.equal(down.status, 503)
            assert.deepEqual(down.body, {
              status: 'degraded',
              dependencies: { postgres: 'down', redis: 'up' },
            })
            assert.ok(!JSON.stringify(down.body).includes(failingUrl.toString()))
          } finally {
            config.set('DATABASE_URL', url.toString())
          }
        },
      )
      await t.test(
        'stalled real Redis bounds command waits, falls back to PostgreSQL and reports failed health',
        async () => {
          redisProxy.stall()
          const start = performance.now()
          // Unique query guarantees a miss and exercises failed GET + SET, not a cached response.
          const result = await list('?limit=71')
          assert.deepEqual(result.data, expected.slice(0, 71))
          assert.ok(performance.now() - start < 1500)
          const health = await request<HealthDto>('health')
          assert.equal(health.status, 503)
          assert.deepEqual(health.body, {
            status: 'degraded',
            dependencies: { postgres: 'up', redis: 'down' },
          })
          cache.client.disconnect()
          assert.deepEqual((await list('?limit=70')).data, expected.slice(0, 70))
        },
      )
    } finally {
      const cacheClient = app?.get(CacheService).client
      await app?.close()
      if (cacheClient) assert.equal(cacheClient.status, 'end')
      await database?.destroy()
      // Remove only this random test namespace, never FLUSHALL/FLUSHDB or development keys.
      const keys = await inspection.keys(namespace + ':*')
      if (keys.length) await inspection.del(...keys)
      inspection.disconnect()
      await redisProxy.close()
      await stalledPostgres.close()
      if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`)
      await admin.destroy()
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  },
)
