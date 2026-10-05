import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSource, readSource } from '../seed-source'

test('canonical source normalization preserves source values and missing fields', async () => {
  const source = parseSource(await readSource())
  assert.equal(source.checksum, '19eee95c4676faf2ef56b34dd6533dc719c3073ae282cac61531b1822370fece')
  assert.equal(source.characters.length, 208)
  assert.equal(source.abilities.length, 1040)
  assert.equal(source.tags.length, 523)
  assert.equal(source.characters[0]?.id, 208)
  assert.equal(source.characters[0]?.source_order, 0)
  assert.equal(source.characters.find((character) => character.id === 25)?.quote, null)
  assert.equal(source.characters.find((character) => character.id === 42)?.thumbnail, null)
  assert.deepEqual(
    source.tags.filter((tag) => tag.character_id === 31),
    [],
  )
  assert.ok(source.tags.some((tag) => tag.tag_name === 'grapple'))
  assert.ok(source.tags.some((tag) => tag.tag_name === 'grappling'))
})

test('invalid JSON and empty sources are rejected', () => {
  assert.throws(() => parseSource(Buffer.from('{broken')), /not valid JSON/)
  assert.throws(() => parseSource(Buffer.from('[]')), /Invalid character source/)
})

test('validation rejects duplicate identities, invalid ranges and unknown fields', async () => {
  const raw = await readSource()
  const valid = JSON.parse(raw.toString('utf8')) as {
    id: number
    abilities: { abilityName: string; abilityScore: number }[]
    tags?: { slot: number; tag_name: string }[]
  }[]
  const first = valid[0]!
  const cases: unknown[] = [
    [first, first],
    [{ ...first, id: 0 }],
    [{ ...first, id: 1.5 }],
    [{ ...first, surprise: true }],
    [{ ...first, abilities: first.abilities.slice(1) }],
    [{ ...first, abilities: first.abilities.map(() => first.abilities[0]) }],
    [
      {
        ...first,
        abilities: [{ ...first.abilities[0], abilityScore: 11 }, ...first.abilities.slice(1)],
      },
    ],
    [
      {
        ...first,
        abilities: [{ ...first.abilities[0], abilityScore: 1.5 }, ...first.abilities.slice(1)],
      },
    ],
    [
      {
        ...first,
        tags: [
          { slot: 1, tag_name: 'human' },
          { slot: 1, tag_name: 'robot' },
        ],
      },
    ],
    [{ ...first, tags: [{ slot: 4, tag_name: 'human' }] }],
    [{ ...first, thumbnail: null }],
  ]
  for (const invalid of cases) {
    assert.throws(
      () => parseSource(Buffer.from(JSON.stringify(invalid))),
      /Invalid character source/,
    )
  }
})

test('byte changes affect checksum while original arrays retain their order', async () => {
  const raw = await readSource()
  const source = parseSource(raw)
  const whitespaceChange = parseSource(Buffer.concat([raw, Buffer.from('\n')]))
  assert.notEqual(whitespaceChange.checksum, source.checksum)
  assert.deepEqual(whitespaceChange.characters, source.characters)
  assert.deepEqual(whitespaceChange.abilities, source.abilities)
  assert.deepEqual(whitespaceChange.tags, source.tags)
})
