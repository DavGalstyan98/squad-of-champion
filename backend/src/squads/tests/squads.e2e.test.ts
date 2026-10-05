import type { Result, DomainError } from './squads-e2e.types'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DataSource } from 'typeorm'
import { createDataSource, databaseUrl } from '../../database/data-source'
import { readSource } from '../../database/seed-source'
import { seedCatalogue } from '../../database/seed'
import { configureApp } from '../../configure-app'
import { ApiException } from '../../common/api-exception'
import { SquadsService } from '../squads.service'
import type { SquadDto } from '../squads.dto'
import type { CharacterDto } from '../../catalogue/catalogue.dto'
import type { Environment } from '../../config/environment'

function error(response: Result, status: number, code: string): void {
  assert.equal(response.status, status)
  const body = response.body as DomainError
  assert.equal(body.statusCode, status)
  assert.equal(body.error, code)
  assert.ok(body.message)
  assert.ok(
    Object.keys(body).every((key) => ['statusCode', 'error', 'message', 'details'].includes(key)),
  )
}
function ids(squad: SquadDto): number[] {
  return squad.members.map((member) => member.character.id)
}
function invariant(squad: SquadDto): void {
  assert.ok(squad.members.length <= 6)
  assert.equal(new Set(ids(squad)).size, squad.members.length)
  assert.deepEqual(
    squad.members.map((member) => member.position),
    squad.members.map((_member, index) => index + 1),
  )
  assert.equal(squad.statistics.memberCount, squad.members.length)
}

test(
  'owned squads HTTP/services and deliberately overlapping transactions on real PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    if (process.env.NODE_ENV === 'production') throw new Error('Squad tests refuse production')
    const adminUrl = databaseUrl(process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL)
    const dbName = `squad_owned_test_${randomUUID().replaceAll('-', '')}`
    const url = new URL(adminUrl)
    url.pathname = '/' + dbName
    const overrides = {
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      JWT_SECRET: randomBytes(64).toString('hex'),
      CORS_ORIGINS: 'http://localhost:3000',
      SQUAD_LOCK_TIMEOUT_MS: '5000',
      SQUAD_STATEMENT_TIMEOUT_MS: '10000',
      CACHE_NAMESPACE: 'test_squads_' + randomUUID().replaceAll('-', ''),
      REDIS_URL: process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    }
    const original = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    )
    const admin = await createDataSource(adminUrl).initialize()
    const connections: DataSource[] = []
    let app: INestApplication | undefined
    let created = false
    try {
      await admin.query(`CREATE DATABASE "${dbName}"`)
      created = true
      const db = await createDataSource(url.toString()).initialize()
      connections.push(db)
      await db.runMigrations()
      const raw = await readSource()
      await seedCatalogue(db, raw)
      const source = JSON.parse(raw.toString()) as CharacterDto[]
      Object.assign(process.env, overrides)
      const { AppModule } = await import('../../app.module')
      app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
      configureApp(app)
      await app.listen(0, '127.0.0.1')
      const origin = await app.getUrl()
      const config = app.get(ConfigService<Environment, true>)
      const service = app.get(SquadsService)
      const appDb = app.get(DataSource)
      const request = async (
        method: string,
        path: string,
        token?: string,
        body?: unknown,
      ): Promise<Result> => {
        const response = await fetch(origin + '/api/v1/' + path, {
          method,
          headers: {
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(12000),
        })
        return {
          status: response.status,
          body: response.status === 204 ? undefined : await response.json(),
        }
      }
      const account = async (suffix: string) => {
        const email = suffix + '@squads.example.com'
        const password = randomBytes(20).toString('hex')
        const registered = await request('POST', 'auth/register', undefined, { email, password })
        assert.equal(registered.status, 201)
        const login = await request('POST', 'auth/login', undefined, { email, password })
        assert.equal(login.status, 200)
        return {
          id: (registered.body as { id: string }).id,
          token: (login.body as { accessToken: string }).accessToken,
        }
      }
      const a = await account('owner-a'),
        b = await account('owner-b')
      const create = async (name: string, characterIds: number[] = []): Promise<SquadDto> => {
        const response = await request('POST', 'squads', a.token, { name, characterIds })
        assert.equal(response.status, 201)
        return response.body as SquadDto
      }
      const verifyStatistics = (squad: SquadDto): void => {
        invariant(squad)
        for (const [ability, actual] of Object.entries(squad.statistics.averages)) {
          const scores = ids(squad).map(
            (id) =>
              source
                .find((character) => character.id === id)!
                .abilities.find((value) => value.abilityName === ability)!.abilityScore,
          )
          assert.equal(
            actual,
            scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
          )
        }
        for (const member of squad.members) {
          const character = source.find((character) => character.id === member.character.id)!
          assert.deepEqual(member.character, {
            id: character.id,
            name: character.name,
            quote: character.quote ?? null,
            image: character.image,
            thumbnail: character.thumbnail ?? null,
            universe: character.universe,
            abilities: character.abilities,
            tags: character.tags ?? [],
          })
        }
      }
      await t.test(
        'CRUD, ordered initial members, rename/replacement, add/remove and known/empty statistics',
        async () => {
          const empty = await create('  Empty squad  ')
          assert.equal(empty.name, 'Empty squad')
          verifyStatistics(empty)
          const original = await create('Initial', [25, 31, 42])
          verifyStatistics(original)
          assert.deepEqual(ids(original), [25, 31, 42])
          const get = await request('GET', 'squads/' + original.id, a.token)
          assert.equal(get.status, 200)
          assert.deepEqual(get.body, original)
          const renamed = await request('PATCH', 'squads/' + original.id, a.token, {
            name: ' Renamed ',
          })
          assert.equal(renamed.status, 200)
          assert.equal((renamed.body as SquadDto).name, 'Renamed')
          assert.deepEqual(ids(renamed.body as SquadDto), [25, 31, 42])
          const replaced = await request('PATCH', 'squads/' + original.id, a.token, {
            name: 'Replaced',
            characterIds: [208, 2, 1],
          })
          assert.equal(replaced.status, 200)
          verifyStatistics(replaced.body as SquadDto)
          assert.deepEqual(ids(replaced.body as SquadDto), [208, 2, 1])
          const add = await request('POST', `squads/${original.id}/characters/3`, a.token)
          assert.equal(add.status, 200)
          assert.deepEqual(ids(add.body as SquadDto), [208, 2, 1, 3])
          verifyStatistics(add.body as SquadDto)
          const remove = await request('DELETE', `squads/${original.id}/characters/2`, a.token)
          assert.equal(remove.status, 200)
          assert.deepEqual(ids(remove.body as SquadDto), [208, 1, 3])
          verifyStatistics(remove.body as SquadDto)
          const cleared = await request('PATCH', 'squads/' + original.id, a.token, {
            characterIds: [],
          })
          assert.equal(cleared.status, 200)
          verifyStatistics(cleared.body as SquadDto)
          const list = await request('GET', 'squads', a.token)
          assert.equal(list.status, 200)
          assert.ok((list.body as SquadDto[]).some((squad) => squad.id === original.id))
          const deleted = await request('DELETE', 'squads/' + original.id, a.token)
          assert.equal(deleted.status, 204)
          assert.equal(deleted.body, undefined)
          error(await request('GET', 'squads/' + original.id, a.token), 404, 'SQUAD_NOT_FOUND')
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS count FROM squad_members WHERE squad_id=$1', [
                original.id,
              ])
            )[0].count,
            0,
          )
        },
      )
      await t.test(
        'every read/write is owner-scoped; two users, missing and nonowned equivalence, all unauthenticated routes',
        async () => {
          const owned = await create('Private', [1, 2])
          const before = await service.find(a.id, owned.id)
          const operations: [string, string, unknown?][] = [
            ['GET', 'squads'],
            ['POST', 'squads', { name: 'No auth' }],
            ['GET', 'squads/' + owned.id],
            ['PATCH', 'squads/' + owned.id, { name: 'Stolen' }],
            ['DELETE', 'squads/' + owned.id],
            ['POST', `squads/${owned.id}/characters/3`],
            ['DELETE', `squads/${owned.id}/characters/1`],
          ]
          for (const [method, path, body] of operations)
            error(await request(method, path, undefined, body), 401, 'UNAUTHORIZED')
          for (const [method, suffix, body] of [
            ['GET', '', undefined],
            ['PATCH', '', { name: 'Stolen' }],
            ['PATCH', '', { characterIds: [3] }],
            ['DELETE', '', undefined],
            ['POST', '/characters/3', undefined],
            ['DELETE', '/characters/1', undefined],
          ] as [string, string, unknown][]) {
            const denied = await request(method, 'squads/' + owned.id + suffix, b.token, body)
            const absent = await request(method, 'squads/' + randomUUID() + suffix, b.token, body)
            error(denied, 404, 'SQUAD_NOT_FOUND')
            assert.deepEqual(denied, absent)
          }
          const bSquad = await request('POST', 'squads', b.token, { name: 'B only' })
          assert.equal(bSquad.status, 201)
          const bList = await request('GET', 'squads', b.token)
          assert.deepEqual(
            (bList.body as SquadDto[]).map((squad) => squad.id),
            [(bSquad.body as SquadDto).id],
          )
          error(
            await request('POST', 'squads', b.token, { name: 'Spoof', ownerId: a.id }),
            400,
            'VALIDATION_ERROR',
          )
          error(
            await request('PATCH', 'squads/' + owned.id, a.token, { ownerId: b.id }),
            400,
            'VALIDATION_ERROR',
          )
          assert.deepEqual(await service.find(a.id, owned.id), before)
          for (const action of [
            () => service.find(b.id, owned.id),
            () => service.patch(b.id, owned.id, { name: 'Spoof' }),
            () => service.add(b.id, owned.id, 3),
            () => service.remove(b.id, owned.id, 1),
            () => service.delete(b.id, owned.id),
          ])
            await assert.rejects(
              action(),
              (failure: unknown) =>
                failure instanceof ApiException && failure.body.error === 'SQUAD_NOT_FOUND',
            )
        },
      )
      await t.test(
        'six-member limit, duplicate and missing IDs, DTO errors and invalid-batch rollback through HTTP/services',
        async () => {
          const squad = await create('Six', [1, 2, 3, 4, 5, 6])
          error(
            await request('POST', `squads/${squad.id}/characters/7`, a.token),
            409,
            'SQUAD_FULL',
          )
          error(
            await request('POST', `squads/${squad.id}/characters/1`, a.token),
            409,
            'CHARACTER_ALREADY_IN_SQUAD',
          )
          error(
            await request('POST', `squads/${squad.id}/characters/9999`, a.token),
            404,
            'CHARACTER_NOT_FOUND',
          )
          error(
            await request('DELETE', `squads/${squad.id}/characters/7`, a.token),
            404,
            'SQUAD_MEMBER_NOT_FOUND',
          )
          for (const body of [
            {},
            { name: '' },
            { name: null },
            { characterIds: null },
            { characterIds: [1, 1] },
            { characterIds: [1, 2, 3, 4, 5, 6, 7] },
            { characterIds: ['1'] },
            { characterIds: [0] },
            { statistics: { memberCount: 0 } },
          ])
            error(
              await request('PATCH', 'squads/' + squad.id, a.token, body),
              400,
              'VALIDATION_ERROR',
            )
          error(await request('GET', 'squads/not-a-uuid', a.token), 400, 'VALIDATION_ERROR')
          error(
            await request('POST', `squads/${squad.id}/characters/-1`, a.token),
            400,
            'VALIDATION_ERROR',
          )
          error(
            await request('PATCH', 'squads/' + squad.id, a.token, {
              name: 'Must rollback',
              characterIds: [1, 9999],
            }),
            404,
            'CHARACTER_NOT_FOUND',
          )
          assert.deepEqual(await service.find(a.id, squad.id), squad)
          const before: unknown = await db.query('SELECT count(*) FROM squads WHERE owner_id=$1', [
            a.id,
          ])
          error(
            await request('POST', 'squads', a.token, {
              name: 'Must not exist',
              characterIds: [1, 9999],
            }),
            404,
            'CHARACTER_NOT_FOUND',
          )
          assert.deepEqual(
            await db.query('SELECT count(*) FROM squads WHERE owner_id=$1', [a.id]),
            before,
          )
          for (const characterIds of [[1, 1], [1, 2, 3, 4, 5, 6, 7], [0], [1, 9999]])
            await assert.rejects(service.patch(a.id, squad.id, { name: 'Invalid', characterIds }))
          await assert.rejects(service.patch(a.id, squad.id, {}))
          assert.deepEqual(await service.find(a.id, squad.id), squad)
        },
      )
      await t.test(
        'injected failure after member deletion/insertion rolls back creation and replacement atomically',
        async () => {
          const squad = await create('Rollback', [1, 2])
          const before = await service.find(a.id, squad.id)
          const count = await db.query('SELECT count(*) FROM squads')
          await db.query(
            "CREATE FUNCTION reject_test_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.character_id = 200 THEN RAISE EXCEPTION 'test member failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_member BEFORE INSERT ON squad_members FOR EACH ROW EXECUTE FUNCTION reject_test_member()",
          )
          try {
            error(
              await request('PATCH', 'squads/' + squad.id, a.token, {
                name: 'No commit',
                characterIds: [3, 200],
              }),
              500,
              'INTERNAL_SERVER_ERROR',
            )
            error(
              await request('POST', 'squads', a.token, {
                name: 'No commit',
                characterIds: [3, 200],
              }),
              500,
              'INTERNAL_SERVER_ERROR',
            )
            assert.deepEqual(await service.find(a.id, squad.id), before)
            assert.deepEqual(await db.query('SELECT count(*) FROM squads'), count)
          } finally {
            await db.query(
              'DROP TRIGGER reject_test_member ON squad_members; DROP FUNCTION reject_test_member()',
            )
          }
        },
      )
      // Different DataSources own distinct pools; blocker + pg_stat_activity barrier proves real overlap.
      const firstDb = await createDataSource(url.toString()).initialize(),
        secondDb = await createDataSource(url.toString()).initialize()
      connections.push(firstDb, secondDb)
      const first = new SquadsService(firstDb, config),
        second = new SquadsService(secondDb, config)
      const overlap = async <T, U>(
        id: string,
        one: () => Promise<T>,
        two: () => Promise<U>,
      ): Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]> => {
        const blocker = db.createQueryRunner()
        await blocker.connect()
        await blocker.startTransaction()
        await blocker.query('SELECT id FROM squads WHERE id=$1 FOR UPDATE', [id])
        const results = Promise.allSettled([one(), two()])
        try {
          const until = performance.now() + 3000
          let waiting: { pid: number }[] = []
          while (performance.now() < until) {
            waiting = await db.query(
              "SELECT pid FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%FROM squads%FOR UPDATE%'",
              [dbName],
            )
            if (waiting.length >= 2) break
            await delay(10)
          }
          assert.ok(
            waiting.length >= 2,
            'Two real transactions must simultaneously wait on squad row lock',
          )
          assert.equal(new Set(waiting.map((row) => row.pid)).size, waiting.length)
          await blocker.rollbackTransaction()
          return (await results) as [PromiseSettledResult<T>, PromiseSettledResult<U>]
        } finally {
          if (blocker.isTransactionActive) await blocker.rollbackTransaction()
          await results
          await blocker.release()
        }
      }
      await t.test(
        'five + two simultaneous distinct service additions: exactly one success and six members',
        async () => {
          const squad = await create('Race capacity', [1, 2, 3, 4, 5])
          const results = await overlap(
            squad.id,
            () => first.add(a.id, squad.id, 6),
            () => second.add(a.id, squad.id, 7),
          )
          assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
          const rejected = results.find(
            (result) => result.status === 'rejected',
          ) as PromiseRejectedResult
          assert.ok(
            rejected.reason instanceof ApiException && rejected.reason.body.error === 'SQUAD_FULL',
          )
          const final = await service.find(a.id, squad.id)
          invariant(final)
          assert.equal(final.members.length, 6)
        },
      )
      await t.test(
        'HTTP capacity race uses overlapping pool connections and one 200/one 409',
        async () => {
          const squad = await create('HTTP race', [1, 2, 3, 4, 5])
          const results = await overlap(
            squad.id,
            () => request('POST', `squads/${squad.id}/characters/6`, a.token),
            () => request('POST', `squads/${squad.id}/characters/7`, a.token),
          )
          assert.ok(results.every((result) => result.status === 'fulfilled'))
          const responses = results.map(
            (result) => (result as PromiseFulfilledResult<Result>).value,
          )
          assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
          error(responses.find((response) => response.status === 409)!, 409, 'SQUAD_FULL')
          invariant(await service.find(a.id, squad.id))
        },
      )
      await t.test(
        'simultaneous duplicate additions at empty/five/full states never duplicate or exceed six',
        async () => {
          for (const initial of [[], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]]) {
            const squad = await create('Duplicate race', initial)
            const id = initial.length === 6 ? 1 : 6
            const results = await overlap(
              squad.id,
              () => first.add(a.id, squad.id, id),
              () => second.add(a.id, squad.id, id),
            )
            assert.equal(
              results.filter((result) => result.status === 'fulfilled').length,
              initial.length === 6 ? 0 : 1,
            )
            for (const result of results)
              if (result.status === 'rejected')
                assert.ok(
                  result.reason instanceof ApiException &&
                    result.reason.body.error === 'CHARACTER_ALREADY_IN_SQUAD',
                )
            const final = await service.find(a.id, squad.id)
            invariant(final)
            assert.equal(ids(final).filter((value) => value === id).length, 1)
          }
        },
      )
      await t.test(
        'replacement/addition, removal/addition and deletion/addition have valid serial outcomes',
        async () => {
          const replacing = await create('Replacement race', [1, 2, 3, 4, 5])
          const replacement = await overlap(
            replacing.id,
            () =>
              first.patch(a.id, replacing.id, {
                name: 'Atomic replacement',
                characterIds: [11, 12, 13, 14, 15, 16],
              }),
            () => second.add(a.id, replacing.id, 6),
          )
          assert.equal(replacement[0].status, 'fulfilled')
          if (replacement[1].status === 'rejected')
            assert.equal(replacement[1].reason.body.error, 'SQUAD_FULL')
          const replaced = await service.find(a.id, replacing.id)
          invariant(replaced)
          assert.deepEqual(ids(replaced), [11, 12, 13, 14, 15, 16])
          verifyStatistics(replaced)
          const removing = await create('Removal race', [1, 2, 3, 4, 5, 6])
          const removal = await overlap(
            removing.id,
            () => first.remove(a.id, removing.id, 3),
            () => second.add(a.id, removing.id, 7),
          )
          assert.equal(removal[0].status, 'fulfilled')
          if (removal[1].status === 'rejected')
            assert.equal(removal[1].reason.body.error, 'SQUAD_FULL')
          const removed = await service.find(a.id, removing.id)
          invariant(removed)
          assert.deepEqual(
            ids(removed),
            removal[1].status === 'fulfilled' ? [1, 2, 4, 5, 6, 7] : [1, 2, 4, 5, 6],
          )
          const deleting = await create('Delete race')
          const deletion = await overlap(
            deleting.id,
            () => first.delete(a.id, deleting.id),
            () => second.add(a.id, deleting.id, 1),
          )
          assert.equal(deletion[0].status, 'fulfilled')
          if (deletion[1].status === 'rejected')
            assert.equal(deletion[1].reason.body.error, 'SQUAD_NOT_FOUND')
          await assert.rejects(
            service.find(a.id, deleting.id),
            (failure: unknown) =>
              failure instanceof ApiException && failure.body.error === 'SQUAD_NOT_FOUND',
          )
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS count FROM squad_members WHERE squad_id=$1', [
                deleting.id,
              ])
            )[0].count,
            0,
          )
        },
      )
      await t.test(
        'lock timeout gives bounded consistent 503 and leaves state untouched',
        async () => {
          const squad = await create('Timeout', [1])
          const runner = db.createQueryRunner()
          await runner.connect()
          await runner.startTransaction()
          await runner.query('SELECT id FROM squads WHERE id=$1 FOR UPDATE', [squad.id])
          config.set('SQUAD_LOCK_TIMEOUT_MS', 100)
          try {
            const start = performance.now()
            error(
              await request('POST', `squads/${squad.id}/characters/2`, a.token),
              503,
              'SQUAD_BUSY',
            )
            assert.ok(performance.now() - start < 1500)
          } finally {
            config.set('SQUAD_LOCK_TIMEOUT_MS', 5000)
            await runner.rollbackTransaction()
            await runner.release()
          }
          assert.deepEqual(await service.find(a.id, squad.id), squad)
        },
      )
      await t.test(
        'independent database constraints reject duplicates, invalid references, positions and capacity',
        async () => {
          const squad = await create('Constraints', [1])
          for (const [characterId, position, code] of [
            [1, 2, '23505'],
            [9999, 2, '23503'],
            [2, 1, '23505'],
            [2, 0, '23514'],
            [2, 7, '23514'],
          ] as [number, number, string][])
            await assert.rejects(
              db.query(
                'INSERT INTO squad_members(squad_id,character_id,position) VALUES($1,$2,$3)',
                [squad.id, characterId, position],
              ),
              (failure: unknown) =>
                typeof failure === 'object' &&
                failure !== null &&
                'driverError' in failure &&
                (failure.driverError as { code: string }).code === code,
            )
          assert.deepEqual(await service.find(a.id, squad.id), squad)
        },
      )
      await t.test(
        'valid preexisting position gaps compact on addition without changing relative member order',
        async () => {
          const squad = await create('Position gaps', [1])
          await db.query('UPDATE squad_members SET position=6 WHERE squad_id=$1', [squad.id])
          const added = await first.add(a.id, squad.id, 2)
          invariant(added)
          assert.deepEqual(ids(added), [1, 2])
        },
      )
      await t.test(
        'GET snapshot cannot mix squad metadata/members/statistics across concurrent replacement or catalogue seed',
        async () => {
          const squad = await create('Old snapshot', [1, 2])
          const runnerFactory = appDb.createQueryRunner.bind(appDb)
          let entered!: () => void, release!: () => void
          const arrived = new Promise<void>((resolve) => {
              entered = resolve
            }),
            gate = new Promise<void>((resolve) => {
              release = resolve
            })
          let blocked = false
          appDb.createQueryRunner = (...args) => {
            const runner = runnerFactory(...args),
              query = runner.query.bind(runner)
            runner.query = async (...queryArgs: Parameters<typeof runner.query>) => {
              const result = await query(...queryArgs)
              if (
                !blocked &&
                queryArgs[0].includes('FROM squads WHERE id =') &&
                !queryArgs[0].includes('FOR UPDATE')
              ) {
                blocked = true
                entered()
                await gate
              }
              return result
            }
            return runner
          }
          const pending = request('GET', 'squads/' + squad.id, a.token)
          try {
            await arrived
            await first.patch(a.id, squad.id, { name: 'New snapshot', characterIds: [3, 4] })
            const fixture = structuredClone(source)
            fixture.find((c) => c.id === 1)!.abilities[0]!.abilityScore =
              source.find((c) => c.id === 1)!.abilities[0]!.abilityScore === 10 ? 1 : 10
            await seedCatalogue(db, Buffer.from(JSON.stringify(fixture)))
            release()
            const old = await pending
            assert.equal(old.status, 200)
            assert.deepEqual(old.body, squad)
            assert.deepEqual(ids(await service.find(a.id, squad.id)), [3, 4])
          } finally {
            release()
            await pending
            appDb.createQueryRunner = runnerFactory
            await seedCatalogue(db, raw)
          }
        },
      )
      await t.test(
        'list snapshot keeps all squads, members and abilities coherent during replacement/deletion',
        async () => {
          const changing = await create('List snapshot', [1, 2])
          const deleting = await create('List snapshot delete', [3])
          const before = await service.list(a.id)
          const runnerFactory = appDb.createQueryRunner.bind(appDb)
          let entered!: () => void, release!: () => void
          const arrived = new Promise<void>((resolve) => {
            entered = resolve
          })
          const gate = new Promise<void>((resolve) => {
            release = resolve
          })
          let blocked = false
          appDb.createQueryRunner = (...args) => {
            const runner = runnerFactory(...args),
              query = runner.query.bind(runner)
            runner.query = async (...queryArgs: Parameters<typeof runner.query>) => {
              const result = await query(...queryArgs)
              if (!blocked && queryArgs[0].includes('FROM squad_members m JOIN characters')) {
                blocked = true
                entered()
                await gate
              }
              return result
            }
            return runner
          }
          const pending = request('GET', 'squads', a.token)
          try {
            await arrived
            await first.patch(a.id, changing.id, {
              name: 'Changed list snapshot',
              characterIds: [4, 5],
            })
            await second.delete(a.id, deleting.id)
            const fixture = structuredClone(source)
            fixture.find((c) => c.id === 1)!.abilities[0]!.abilityScore =
              source.find((c) => c.id === 1)!.abilities[0]!.abilityScore === 10 ? 1 : 10
            await seedCatalogue(db, Buffer.from(JSON.stringify(fixture)))
            release()
            const result = await pending
            assert.equal(result.status, 200)
            assert.deepEqual(result.body, before)
            const after = await service.list(a.id)
            assert.ok(!after.some((squad) => squad.id === deleting.id))
            assert.deepEqual(ids(after.find((squad) => squad.id === changing.id)!), [4, 5])
          } finally {
            release()
            await pending
            appDb.createQueryRunner = runnerFactory
            await seedCatalogue(db, raw)
          }
        },
      )
      await t.test(
        'statement timeout rolls back an in-progress mutation with the same bounded error',
        async () => {
          const squad = await create('Statement timeout', [1])
          await db.query(
            'CREATE FUNCTION slow_test_squad() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER slow_test_squad BEFORE UPDATE ON squads FOR EACH ROW EXECUTE FUNCTION slow_test_squad()',
          )
          config.set('SQUAD_LOCK_TIMEOUT_MS', 50)
          config.set('SQUAD_STATEMENT_TIMEOUT_MS', 100)
          try {
            const start = performance.now()
            error(
              await request('POST', `squads/${squad.id}/characters/2`, a.token),
              503,
              'SQUAD_BUSY',
            )
            assert.ok(performance.now() - start < 1500)
          } finally {
            config.set('SQUAD_LOCK_TIMEOUT_MS', 5000)
            config.set('SQUAD_STATEMENT_TIMEOUT_MS', 10000)
            await db.query(
              'DROP TRIGGER slow_test_squad ON squads; DROP FUNCTION slow_test_squad()',
            )
          }
          assert.deepEqual(await service.find(a.id, squad.id), squad)
        },
      )
      await t.test(
        'batched query counts remain constant and record local HTTP/service latency measurement',
        async () => {
          const measuredOwner = await account('measurement-owner')
          const measured = []
          for (const size of [0, 1, 6])
            measured.push(
              await service.create(measuredOwner.id, {
                name: 'Measured ' + size,
                characterIds: Array.from({ length: size }, (_value, index) => index + 1),
              }),
            )
          const squad = measured[2]!
          const sql: string[] = [],
            previous = appDb.logger.logQuery
          appDb.logger.logQuery = (query) => {
            sql.push(query)
          }
          const breakdown = () => ({
            statements: sql.length,
            dataSelects: sql.filter(
              (query) => /^SELECT/.test(query) && !query.includes('set_config'),
            ).length,
            abilityQueries: sql.filter((query) => query.includes('FROM character_abilities'))
              .length,
            tagQueries: sql.filter((query) => query.includes('FROM character_tags')).length,
          })
          const matrix: unknown[] = []
          try {
            for (const item of measured) {
              const size = item.members.length
              sql.length = 0
              await service.find(measuredOwner.id, item.id)
              const serviceCount = breakdown()
              assert.equal(serviceCount.statements, size ? 9 : 7)
              assert.equal(serviceCount.dataSelects, size ? 4 : 2)
              assert.equal(serviceCount.abilityQueries, size ? 1 : 0)
              assert.equal(serviceCount.tagQueries, size ? 1 : 0)
              sql.length = 0
              const response = await request('GET', 'squads/' + item.id, measuredOwner.token)
              assert.equal(response.status, 200)
              assert.equal(sql.length, serviceCount.statements + 1)
              matrix.push({
                resource: 'detail',
                members: size,
                service: serviceCount,
                httpStatements: sql.length,
              })
            }
            const listOwner = await account('list-measurement-owner')
            for (const size of [0, 1, 6, 18]) {
              // Isolated owner; fixture writes are excluded by clearing counters before each measurement.
              for (let index = (await service.list(listOwner.id)).length; index < size; index++)
                await service.create(listOwner.id, {
                  name: 'List ' + index,
                  characterIds: [1, 2, 3, 4, 5, 6],
                })
              sql.length = 0
              const list = await service.list(listOwner.id)
              assert.equal(list.length, size)
              const serviceCount = breakdown()
              assert.equal(serviceCount.statements, size ? 9 : 6)
              assert.equal(serviceCount.dataSelects, size ? 4 : 1)
              assert.equal(serviceCount.abilityQueries, size ? 1 : 0)
              assert.equal(serviceCount.tagQueries, size ? 1 : 0)
              sql.length = 0
              assert.equal((await request('GET', 'squads', listOwner.token)).status, 200)
              assert.equal(sql.length, serviceCount.statements + 1)
              matrix.push({
                resource: 'list',
                squads: size,
                membersPerSquad: 6,
                service: serviceCount,
                httpStatements: sql.length,
              })
            }
            // Multiple empty squads skip both relation queries regardless of squad count.
            for (const item of await service.list(listOwner.id))
              await service.patch(listOwner.id, item.id, { characterIds: [] })
            sql.length = 0
            assert.equal((await service.list(listOwner.id)).length, 18)
            const emptyList = breakdown()
            assert.equal(emptyList.statements, 7)
            assert.equal(emptyList.abilityQueries, 0)
            assert.equal(emptyList.tagQueries, 0)
            sql.length = 0
            assert.equal((await request('GET', 'squads', listOwner.token)).status, 200)
            assert.equal(sql.length, 8)
            matrix.push({
              resource: 'list',
              squads: 18,
              membersPerSquad: 0,
              service: emptyList,
              httpStatements: 8,
            })
            t.diagnostic(
              JSON.stringify({
                queryCountMatrix: matrix,
                explanation:
                  'Five transaction/config statements; one authenticated-user SELECT only at HTTP boundary. Relations batch across all members/squads.',
              }),
            )
            const serviceQueries = 9,
              httpQueries = 10
            // Sequential warm samples only, no load generator or performance claim.
            appDb.logger.logQuery = previous
            const samples: number[] = []
            for (let index = 0; index < 30; index++) {
              const start = performance.now()
              const result = await request('GET', 'squads/' + squad.id, measuredOwner.token)
              assert.equal(result.status, 200)
              samples.push(performance.now() - start)
            }
            samples.sort((x, y) => x - y)
            t.diagnostic(
              JSON.stringify({
                measurement:
                  'warm sequential HTTP GET, six members, 208-character isolated DB, local PostgreSQL17 Docker, Node24, ts-node, no Redis squad cache',
                samples: samples.length,
                serviceStatements: serviceQueries,
                httpStatements: httpQueries,
                listSquads: 18,
                listStatements: 9,
                p50Ms: Number(samples[14]!.toFixed(2)),
                p95Ms: Number(samples[28]!.toFixed(2)),
                maxMs: Number(samples[29]!.toFixed(2)),
              }),
            )
          } finally {
            appDb.logger.logQuery = previous
          }
        },
      )
      await t.test(
        'Swagger covers all protected squad methods, replacement DTO and nullable averages',
        async () => {
          const response = await fetch(origin + '/api/docs-json')
          const spec = (await response.json()) as {
            paths: Record<
              string,
              Record<string, { security: unknown[]; responses: Record<string, unknown> }>
            >
            components: {
              schemas: Record<
                string,
                { properties: Record<string, { nullable?: boolean; items?: { type?: string } }> }
              >
            }
          }
          for (const [path, methods] of [
            ['/api/v1/squads', ['get', 'post']],
            ['/api/v1/squads/{id}', ['get', 'patch', 'delete']],
            ['/api/v1/squads/{id}/characters/{characterId}', ['post', 'delete']],
          ] as [string, string[]][])
            for (const method of methods) {
              assert.ok(spec.paths[path]![method]!.security.length)
              assert.ok(spec.paths[path]![method]!.responses['401'])
              assert.ok(spec.paths[path]![method]!.responses['503'])
            }
          for (const schema of ['CreateSquadDto', 'PatchSquadDto'])
            assert.equal(
              spec.components.schemas[schema]!.properties.characterIds?.items?.type,
              'integer',
            )
          assert.equal(
            spec.components.schemas.AbilityAveragesDto!.properties.Mobility?.nullable,
            true,
          )
        },
      )
    } finally {
      await app?.close()
      for (const connection of connections.reverse())
        if (connection.isInitialized) await connection.destroy()
      if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`)
      await admin.destroy()
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  },
)
