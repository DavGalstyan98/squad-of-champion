import type { CharacterRow, AbilityRow, TagRow } from './character.types'
import type { EntityManager } from 'typeorm'
import type { CharacterDto } from './catalogue.dto'

export async function mapCharacters(
  manager: EntityManager,
  rows: CharacterRow[],
): Promise<CharacterDto[]> {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  // Two batched child queries, independent of page size; no Cartesian product or N+1.
  const abilities: AbilityRow[] = await manager.query(
    'SELECT character_id, ability_name, ability_score FROM character_abilities WHERE character_id = ANY($1::int[]) ORDER BY character_id, source_order',
    [ids],
  )
  const tags: TagRow[] = await manager.query(
    'SELECT character_id, slot, tag_name FROM character_tags WHERE character_id = ANY($1::int[]) ORDER BY character_id, slot',
    [ids],
  )
  const mapped = new Map<number, CharacterDto>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        quote: row.quote ?? null,
        image: row.image,
        thumbnail: row.thumbnail ?? null,
        universe: row.universe,
        abilities: [],
        tags: [],
      },
    ]),
  )
  for (const row of abilities)
    mapped
      .get(row.character_id)
      ?.abilities.push({ abilityName: row.ability_name, abilityScore: row.ability_score })
  for (const row of tags)
    mapped.get(row.character_id)?.tags.push({ slot: row.slot, tag_name: row.tag_name })
  return rows.map((row) => mapped.get(row.id)!)
}
