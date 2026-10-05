import type { RawCharacter } from './database-test.types'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import type { DataSource } from 'typeorm'
import { createDataSource, databaseUrl } from '../data-source'
import { seedCatalogue } from '../seed'
import { readSource } from '../seed-source'

const tables = [
  'characters',
  'character_abilities',
  'character_tags',
  'users',
  'squads',
  'squad_members',
  'catalog_state',
] as const

async function snapshot(database: DataSource): Promise<unknown[]> {
  return Promise.all(tables.map((table) => database.query(`SELECT * FROM ${table} ORDER BY 1, 2`)))
}

async function assertExactImport(database: DataSource, raw: Buffer): Promise<void> {
  // Build expectations directly from raw JSON, independently of importer normalization.
  const source = JSON.parse(raw.toString('utf8')) as RawCharacter[]
  const actualCharacters: unknown = await database.query(
    'SELECT id, name, quote, image, thumbnail, universe, source_order FROM characters ORDER BY source_order',
  )
  assert.deepEqual(
    actualCharacters,
    source.map((character, source_order) => ({
      id: character.id,
      name: character.name,
      quote: character.quote ?? null,
      image: character.image,
      thumbnail: character.thumbnail ?? null,
      universe: character.universe,
      source_order,
    })),
  )
  const expectedAbilities = source
    .flatMap((character) =>
      character.abilities.map((ability, source_order) => ({
        character_id: character.id,
        ability_name: ability.abilityName,
        ability_score: ability.abilityScore,
        source_order,
      })),
    )
    .sort((a, b) => a.character_id - b.character_id || a.source_order - b.source_order)
  const actualAbilities: unknown = await database.query(
    'SELECT * FROM character_abilities ORDER BY character_id, source_order',
  )
  assert.deepEqual(actualAbilities, expectedAbilities)
  const expectedTags = source
    .flatMap((character) =>
      (character.tags ?? []).map((tag) => ({
        character_id: character.id,
        slot: tag.slot,
        tag_name: tag.tag_name,
      })),
    )
    .sort((a, b) => a.character_id - b.character_id || a.slot - b.slot)
  const actualTags: unknown = await database.query(
    'SELECT * FROM character_tags ORDER BY character_id, slot',
  )
  assert.deepEqual(actualTags, expectedTags)
}

async function state(
  database: DataSource,
): Promise<{ revision: string; source_checksum: string | null }> {
  const [result] = await database.query<{ revision: string; source_checksum: string | null }[]>(
    'SELECT revision, source_checksum FROM catalog_state WHERE id = 1',
  )
  assert.ok(result)
  return result
}

function pgCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.equal((error as { driverError?: { code?: string } }).driverError?.code, code)
    return true
  }
}

test(
  'migrations, exact seeding, rollback and constraints on isolated PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Database tests refuse NODE_ENV=production')
    const adminUrl = databaseUrl(process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL)
    const testName = `squad_test_${randomUUID().replaceAll('-', '')}`
    const testUrl = new URL(adminUrl)
    testUrl.pathname = `/${testName}`
    const admin = await createDataSource(adminUrl).initialize()
    let database: DataSource | undefined
    let created = false
    try {
      // This name is generated here; no configured database is ever reset or dropped.
      await admin.query(`CREATE DATABASE "${testName}"`)
      created = true
      database = await createDataSource(testUrl.toString()).initialize()
      const db = database
      const raw = await readSource()

      await t.test('clean versioned migrations succeed without synchronize', async () => {
        assert.equal(db.options.synchronize, false)
        assert.equal((await db.runMigrations()).length, 2)
        assert.equal((await db.runMigrations()).length, 0)
        assert.deepEqual(await state(db), { revision: '0', source_checksum: null })
        const migrations = await db.query<{ name: string }[]>(
          'SELECT name FROM schema_migrations ORDER BY id',
        )
        assert.deepEqual(
          migrations.map((migration) => migration.name),
          ['InitialSchema1791192000000', 'QueryIndexes1791192000001'],
        )
      })

      await t.test(
        'two seeds import every original value and leave revision unchanged on repeat',
        async () => {
          const first = await seedCatalogue(db, raw)
          assert.equal(first.changed, true)
          assert.equal(first.revision, '1')
          const before = await snapshot(db)
          const second = await seedCatalogue(db, raw)
          assert.equal(second.changed, false)
          assert.equal(second.revision, '1')
          assert.deepEqual(await snapshot(db), before)
          await assertExactImport(db, raw)
          const [counts] = await db.query<
            { characters: number; abilities: number; tags: number }[]
          >(`
        SELECT (SELECT count(*)::integer FROM characters) AS characters,
          (SELECT count(*)::integer FROM character_abilities) AS abilities,
          (SELECT count(*)::integer FROM character_tags) AS tags
      `)
          assert.deepEqual(counts, { characters: 208, abilities: 1040, tags: 523 })
          assert.deepEqual(await db.query('SELECT quote FROM characters WHERE id = 25'), [
            { quote: null },
          ])
          assert.deepEqual(await db.query('SELECT thumbnail FROM characters WHERE id = 42'), [
            { thumbnail: null },
          ])
          assert.deepEqual(
            await db.query('SELECT * FROM character_tags WHERE character_id = 31'),
            [],
          )
        },
      )

      await t.test('invalid source cannot change any table or revision', async () => {
        const source = JSON.parse(raw.toString('utf8')) as RawCharacter[]
        const before = await snapshot(db)
        for (const invalid of [
          Buffer.from('{broken'),
          Buffer.from('[]'),
          Buffer.from(JSON.stringify([source[0], source[0]])),
          Buffer.from(JSON.stringify([{ ...source[0], abilities: [] }])),
        ]) {
          await assert.rejects(seedCatalogue(db, invalid))
          assert.deepEqual(await snapshot(db), before)
        }
        await assert.rejects(
          seedCatalogue(db, Buffer.from(JSON.stringify(source.slice(1)))),
          /removes existing/,
        )
        assert.deepEqual(await snapshot(db), before)
      })

      await t.test('database failure after parent writes rolls back entire seed', async () => {
        await db.query(`
        CREATE FUNCTION fail_seed_tag() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'isolated rollback test'; END $$;
        CREATE TRIGGER fail_seed_tag BEFORE INSERT ON character_tags
        FOR EACH ROW EXECUTE FUNCTION fail_seed_tag();
      `)
        try {
          const source = JSON.parse(raw.toString('utf8')) as RawCharacter[]
          source[0]!.name = 'Rollback fixture'
          const before = await snapshot(db)
          await assert.rejects(
            seedCatalogue(db, Buffer.from(JSON.stringify(source))),
            /isolated rollback test/,
          )
          assert.deepEqual(await snapshot(db), before)
          await assertExactImport(db, raw)
        } finally {
          await db.query(
            'DROP TRIGGER fail_seed_tag ON character_tags; DROP FUNCTION fail_seed_tag()',
          )
        }
      })

      const ownerId = randomUUID()
      const squadId = randomUUID()
      await t.test(
        'foreign keys, duplicate membership, positions and ownership schema constraints',
        async () => {
          await db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
            ownerId,
            'test@example.com',
            'test-only-placeholder',
          ])
          await db.query('INSERT INTO squads (id, owner_id, name) VALUES ($1, $2, $3)', [
            squadId,
            ownerId,
            'Test squad',
          ])
          const insert = (characterId: number, position: number) =>
            db.query(
              'INSERT INTO squad_members (squad_id, character_id, position) VALUES ($1, $2, $3)',
              [squadId, characterId, position],
            )
          await insert(1, 1)
          await assert.rejects(insert(1, 2), pgCode('23505'))
          await assert.rejects(insert(2, 1), pgCode('23505'))
          await assert.rejects(insert(999999, 2), pgCode('23503'))
          await assert.rejects(insert(2, 0), pgCode('23514'))
          await assert.rejects(insert(2, 7), pgCode('23514'))
          await assert.rejects(
            db.query('INSERT INTO squads (owner_id, name) VALUES ($1, $2)', [
              randomUUID(),
              'Bad owner',
            ]),
            pgCode('23503'),
          )
          await assert.rejects(
            db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [
              'Test@Example.com',
              'unused',
            ]),
            pgCode('23514'),
          )
          await assert.rejects(
            db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [
              'test@example.com',
              'unused',
            ]),
            pgCode('23505'),
          )
          await assert.rejects(db.query('DELETE FROM characters WHERE id = 1'), pgCode('23503'))
          for (let position = 2; position <= 6; position++) await insert(position, position)
          await assert.rejects(insert(7, 7), pgCode('23514'))
          assert.equal(
            (
              await db.query<{ count: number }[]>(
                'SELECT count(*)::integer AS count FROM squad_members',
              )
            )[0]?.count,
            6,
          )
        },
      )

      await t.test(
        'changed source replaces children, preserves source order and squads, increments once',
        async () => {
          const source = JSON.parse(raw.toString('utf8')) as RawCharacter[]
          const oldOrder = source[0]!
          source[0] = source[1]!
          source[1] = oldOrder
          source[0]!.quote = 'Changed test quote'
          source[0]!.abilities[0]!.abilityScore = 9
          source[0]!.abilities.reverse()
          source[0]!.tags = [{ slot: 3, tag_name: 'fixture-only' }]
          const changed = Buffer.from(JSON.stringify(source))
          const before = await state(db)
          const usersBefore: unknown = await db.query('SELECT * FROM users')
          const squadsBefore: unknown = await db.query('SELECT * FROM squads')
          const membersBefore: unknown = await db.query(
            'SELECT * FROM squad_members ORDER BY position',
          )
          const result = await seedCatalogue(db, changed)
          assert.equal(BigInt(result.revision), BigInt(before.revision) + 1n)
          await assertExactImport(db, changed)
          assert.equal((await seedCatalogue(db, changed)).changed, false)
          assert.deepEqual(await db.query('SELECT * FROM users'), usersBefore)
          assert.deepEqual(await db.query('SELECT * FROM squads'), squadsBefore)
          assert.deepEqual(
            await db.query('SELECT * FROM squad_members ORDER BY position'),
            membersBefore,
          )
          await seedCatalogue(db, raw)
          await assertExactImport(db, raw)
        },
      )

      await t.test(
        'concurrent seed commands wait on advisory lock and bump revision exactly once',
        async () => {
          const other = await createDataSource(testUrl.toString()).initialize()
          const lock = db.createQueryRunner()
          const before = await state(db)
          const changed = Buffer.concat([raw, Buffer.from('\n')])
          try {
            await lock.connect()
            await lock.startTransaction()
            await lock.query('SELECT pg_advisory_xact_lock(360, 1)')
            const seeds = Promise.all([seedCatalogue(db, changed), seedCatalogue(other, changed)])
            try {
              let waiting = 0
              for (let attempt = 0; attempt < 100; attempt++) {
                const [row] = await db.query<{ count: number }[]>(`
              SELECT count(*)::integer AS count FROM pg_locks
              WHERE locktype = 'advisory' AND classid = 360 AND objid = 1 AND NOT granted
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            `)
                waiting = row?.count ?? 0
                if (waiting === 2) break
                await delay(20)
              }
              assert.equal(waiting, 2, 'Both seed transactions must wait behind the held lock')
            } finally {
              await lock.rollbackTransaction()
            }
            const results = await seeds
            assert.equal(results.filter((result) => result.changed).length, 1)
            assert.equal(BigInt((await state(db)).revision), BigInt(before.revision) + 1n)
            await assertExactImport(db, raw)
          } finally {
            if (lock.isTransactionActive) await lock.rollbackTransaction()
            await lock.release()
            await other.destroy()
          }
          await seedCatalogue(db, raw)
        },
      )

      await t.test(
        'query indexes exist and representative search/filter/owner queries execute',
        async () => {
          const indexes = await db.query<{ indexname: string }[]>(
            'SELECT indexname FROM pg_indexes WHERE schemaname = $1',
            ['public'],
          )
          for (const name of [
            'characters_name_trgm_idx',
            'characters_universe_order_idx',
            'characters_source_order_idx',
            'character_tags_name_character_idx',
            'squads_owner_updated_idx',
            'squad_members_character_idx',
          ]) {
            assert.ok(
              indexes.some((index) => index.indexname === name),
              name,
            )
          }
          const queries: [string, unknown[]][] = [
            [
              'SELECT id FROM characters WHERE lower(name) LIKE $1 ORDER BY source_order, id LIMIT 24',
              ['%bar%'],
            ],
            [
              'SELECT c.id FROM characters c WHERE universe = $1 AND EXISTS (SELECT 1 FROM character_tags t WHERE t.character_id = c.id AND t.tag_name = $2) ORDER BY source_order, id LIMIT 24',
              ['Mortal Kombat', 'human'],
            ],
            [
              'SELECT id FROM squads WHERE owner_id = $1 ORDER BY updated_at DESC, id LIMIT 24',
              [ownerId],
            ],
          ]
          for (const [sql, parameters] of queries) {
            const plan: unknown = await db.query(
              `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
              parameters,
            )
            assert.ok(Array.isArray(plan) && plan.length === 1)
          }
        },
      )

      await t.test('isolated migration rollback and reapply round-trip succeeds', async () => {
        await db.undoLastMigration()
        await db.undoLastMigration()
        assert.equal((await db.runMigrations()).length, 2)
        assert.equal((await seedCatalogue(db, raw)).revision, '1')
        await assertExactImport(db, raw)
      })
    } finally {
      if (database?.isInitialized) await database.destroy()
      // Only the database created by this test is removed; never reset Compose volumes.
      if (created) await admin.query(`DROP DATABASE "${testName}"`)
      await admin.destroy()
    }
  },
)
