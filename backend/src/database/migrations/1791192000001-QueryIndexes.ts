import type { MigrationInterface, QueryRunner } from 'typeorm'

export class QueryIndexes1791192000001 implements MigrationInterface {
  name = 'QueryIndexes1791192000001'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX characters_universe_order_idx ON characters (universe, source_order, id);
      CREATE INDEX characters_source_order_idx ON characters (source_order, id);
      CREATE INDEX characters_name_trgm_idx ON characters USING gin (lower(name) gin_trgm_ops);
      CREATE INDEX character_tags_name_character_idx ON character_tags (tag_name, character_id);
      CREATE INDEX squads_owner_updated_idx ON squads (owner_id, updated_at DESC, id);
      CREATE INDEX squad_members_character_idx ON squad_members (character_id);
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX squad_members_character_idx;
      DROP INDEX squads_owner_updated_idx;
      DROP INDEX character_tags_name_character_idx;
      DROP INDEX characters_name_trgm_idx;
      DROP INDEX characters_source_order_idx;
      DROP INDEX characters_universe_order_idx;
    `)
    // pg_trgm may be shared with other objects; never drop an existing extension.
  }
}
