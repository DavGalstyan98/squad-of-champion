import type { CatalogueSource } from './seed.types'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'

export const canonicalSourcePath = resolve(__dirname, '../../../frontend/src/data/characters.json')
export const abilityNames = ['Mobility', 'Technique', 'Survivability', 'Power', 'Energy'] as const

const characterSchema = z.strictObject({
  id: z.number().int().positive().max(2147483647),
  name: z.string().min(1),
  quote: z.string().optional(),
  image: z.url(),
  thumbnail: z.url().optional(),
  universe: z.string().min(1),
  abilities: z
    .array(
      z.strictObject({
        abilityName: z.enum(abilityNames),
        abilityScore: z.number().int().min(1).max(10),
      }),
    )
    .length(5),
  tags: z
    .array(z.strictObject({ slot: z.number().int().min(1).max(3), tag_name: z.string().min(1) }))
    .max(3)
    .optional(),
})

const sourceSchema = z
  .array(characterSchema)
  .min(1)
  .superRefine((characters, context) => {
    const ids = new Set<number>()
    characters.forEach((character, index) => {
      if (ids.has(character.id)) {
        context.addIssue({ code: 'custom', message: 'Duplicate character ID', path: [index, 'id'] })
      }
      ids.add(character.id)
      if (new Set(character.abilities.map((ability) => ability.abilityName)).size !== 5) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate ability name',
          path: [index, 'abilities'],
        })
      }
      const slots = (character.tags ?? []).map((tag) => tag.slot)
      if (new Set(slots).size !== slots.length) {
        context.addIssue({ code: 'custom', message: 'Duplicate tag slot', path: [index, 'tags'] })
      }
    })
  })

export function parseSource(raw: Buffer): CatalogueSource {
  let json: unknown
  try {
    json = JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    throw new Error('Character source is not valid JSON')
  }
  const result = sourceSchema.safeParse(json)
  if (!result.success) {
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
    throw new Error(`Invalid character source at: ${paths.join(', ')}`)
  }
  const source = result.data
  return {
    checksum: createHash('sha256').update(raw).digest('hex'),
    characters: source.map((character, source_order) => ({
      id: character.id,
      name: character.name,
      quote: character.quote ?? null,
      image: character.image,
      thumbnail: character.thumbnail ?? null,
      universe: character.universe,
      source_order,
    })),
    abilities: source.flatMap((character) =>
      character.abilities.map((ability, source_order) => ({
        character_id: character.id,
        ability_name: ability.abilityName,
        ability_score: ability.abilityScore,
        source_order,
      })),
    ),
    tags: source.flatMap((character) =>
      (character.tags ?? []).map((tag) => ({ character_id: character.id, ...tag })),
    ),
  }
}

export async function readSource(path = canonicalSourcePath): Promise<Buffer> {
  return readFile(path)
}
