import 'reflect-metadata'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CharacterDto } from '../../catalogue/catalogue.dto'
import { validationPipe } from '../../common/validation'
import { validateEnvironment } from '../../config/environment'
import { CreateSquadDto, PatchSquadDto } from '../squads.dto'
import { statistics, abilityNames } from '../statistics'

test('statistics averages original ability scores without rounding and handles empty squads', () => {
  const characters = [1, 2, 4].map((score) => ({
    abilities: abilityNames.map((abilityName, index) => ({
      abilityName,
      abilityScore: score + index,
    })),
  })) as CharacterDto[]
  assert.deepEqual(statistics(characters), {
    memberCount: 3,
    averages: {
      Mobility: 7 / 3,
      Technique: 10 / 3,
      Survivability: 13 / 3,
      Power: 16 / 3,
      Energy: 19 / 3,
    },
  })
  assert.deepEqual(statistics([]), {
    memberCount: 0,
    averages: { Mobility: null, Technique: null, Survivability: null, Power: null, Energy: null },
  })
  assert.throws(
    () => statistics([{ abilities: [] } as unknown as CharacterDto]),
    /Incomplete persisted abilities/,
  )
})
test('squad DTOs trim names, reject nulls, duplicates, oversize and client-owned fields', async () => {
  const pipe = validationPipe()
  const create = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: CreateSquadDto })
  const patch = (value: unknown) => pipe.transform(value, { type: 'body', metatype: PatchSquadDto })
  assert.equal((await create({ name: '  Champions  ', characterIds: [] })).name, 'Champions')
  for (const value of [
    { name: '' },
    { name: '   ' },
    { name: 2 },
    { name: 'x'.repeat(101) },
    { name: 'a', characterIds: null },
    { name: 'a', characterIds: [1, 1] },
    { name: 'a', characterIds: [1, 2, 3, 4, 5, 6, 7] },
    { name: 'a', characterIds: ['1'] },
    { name: 'a', ownerId: 'spoof' },
    { name: 'a', statistics: {} },
  ])
    await assert.rejects(create(value))
  await assert.rejects(patch({ name: null }))
  await assert.rejects(patch({ characterIds: null }))
  assert.deepEqual((await patch({ characterIds: [] })).characterIds, [])
})
test('squad lock/statement deadlines are bounded and ordered', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/squad',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'x'.repeat(64),
    CORS_ORIGINS: 'http://localhost:3000',
  }
  assert.equal(validateEnvironment(base).SQUAD_LOCK_TIMEOUT_MS, 1500)
  for (const values of [
    { SQUAD_LOCK_TIMEOUT_MS: 0 },
    { SQUAD_LOCK_TIMEOUT_MS: 10001 },
    { SQUAD_STATEMENT_TIMEOUT_MS: 30001 },
    { SQUAD_LOCK_TIMEOUT_MS: 2000, SQUAD_STATEMENT_TIMEOUT_MS: 1000 },
  ])
    assert.throws(
      () => validateEnvironment({ ...base, ...values }),
      /Invalid environment configuration/,
    )
})
