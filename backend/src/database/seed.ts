import type { SeedResult } from './seed.types'
import type { DataSource } from 'typeorm'
import { parseSource } from './seed-source'

export async function seedCatalogue(database: DataSource, raw: Buffer): Promise<SeedResult> {
  // Validate the entire snapshot before starting any writes or acquiring a lock.
  const source = parseSource(raw)
  return database.transaction('READ COMMITTED', async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(360, 1)')
    const [state] = await manager.query<{ revision: string; source_checksum: string | null }[]>(
      'SELECT revision, source_checksum FROM catalog_state WHERE id = 1 FOR UPDATE',
    )
    if (!state) throw new Error('Catalogue state missing; run migrations first')
    if (state.source_checksum === source.checksum) {
      return { changed: false, revision: state.revision, checksum: source.checksum }
    }

    const ids = source.characters.map((character) => character.id)
    const removed = await manager.query<{ id: number }[]>(
      'SELECT id FROM characters WHERE NOT (id = ANY($1::integer[]))',
      [ids],
    )
    if (removed.length > 0) {
      throw new Error('Source removes existing character IDs; explicit migration required')
    }
    // Deferring permits a valid source reordering without transient unique conflicts.
    await manager.query('SET CONSTRAINTS characters_source_order_key DEFERRED')
    await manager.query(
      `INSERT INTO characters (id, name, quote, image, thumbnail, universe, source_order)
       SELECT id, name, quote, image, thumbnail, universe, source_order
       FROM jsonb_to_recordset($1::jsonb) AS c(
         id integer, name text, quote text, image text, thumbnail text, universe text, source_order integer
       )
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, quote = EXCLUDED.quote, image = EXCLUDED.image,
         thumbnail = EXCLUDED.thumbnail, universe = EXCLUDED.universe, source_order = EXCLUDED.source_order`,
      [JSON.stringify(source.characters)],
    )
    await manager.query('DELETE FROM character_abilities WHERE character_id = ANY($1::integer[])', [
      ids,
    ])
    await manager.query('DELETE FROM character_tags WHERE character_id = ANY($1::integer[])', [ids])
    await manager.query(
      `INSERT INTO character_abilities (character_id, ability_name, ability_score, source_order)
       SELECT character_id, ability_name, ability_score, source_order
       FROM jsonb_to_recordset($1::jsonb) AS a(
         character_id integer, ability_name text, ability_score integer, source_order integer
       )`,
      [JSON.stringify(source.abilities)],
    )
    await manager.query(
      `INSERT INTO character_tags (character_id, slot, tag_name)
       SELECT character_id, slot, tag_name FROM jsonb_to_recordset($1::jsonb) AS t(
         character_id integer, slot integer, tag_name text
       )`,
      [JSON.stringify(source.tags)],
    )
    const [updated] = await manager.query<{ revision: string }[]>(
      `WITH updated AS (
         UPDATE catalog_state SET revision = revision + 1, source_checksum = $1, updated_at = now()
         WHERE id = 1 RETURNING revision
       ) SELECT revision FROM updated`,
      [source.checksum],
    )
    if (!updated) throw new Error('Catalogue state update failed')
    return { changed: true, revision: updated.revision, checksum: source.checksum }
  })
}
