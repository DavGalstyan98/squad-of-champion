import type { MigrationInterface, QueryRunner } from 'typeorm'

export class InitialSchema1791192000000 implements MigrationInterface {
  name = 'InitialSchema1791192000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE characters (
        id integer PRIMARY KEY CHECK (id > 0),
        name text NOT NULL CHECK (length(name) > 0),
        quote text,
        image text NOT NULL,
        thumbnail text,
        universe text NOT NULL CHECK (length(universe) > 0),
        source_order integer NOT NULL CHECK (source_order >= 0),
        CONSTRAINT characters_source_order_key UNIQUE (source_order) DEFERRABLE
      );

      CREATE TABLE character_abilities (
        character_id integer NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        ability_name text NOT NULL CHECK (
          ability_name IN ('Mobility', 'Technique', 'Survivability', 'Power', 'Energy')
        ),
        ability_score integer NOT NULL CHECK (ability_score BETWEEN 1 AND 10),
        source_order integer NOT NULL CHECK (source_order BETWEEN 0 AND 4),
        PRIMARY KEY (character_id, ability_name),
        UNIQUE (character_id, source_order)
      );

      CREATE TABLE character_tags (
        character_id integer NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        slot integer NOT NULL CHECK (slot BETWEEN 1 AND 3),
        tag_name text NOT NULL CHECK (length(tag_name) > 0),
        PRIMARY KEY (character_id, slot)
      );

      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND length(email) > 0)
      );

      CREATE TABLE squads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (length(btrim(name)) > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE squad_members (
        squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
        character_id integer NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
        position integer NOT NULL CHECK (position BETWEEN 1 AND 6),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (squad_id, character_id),
        UNIQUE (squad_id, position)
      );

      CREATE TABLE catalog_state (
        id integer PRIMARY KEY CHECK (id = 1),
        revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
        source_checksum text CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO catalog_state (id) VALUES (1);
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE catalog_state;
      DROP TABLE squad_members;
      DROP TABLE squads;
      DROP TABLE users;
      DROP TABLE character_tags;
      DROP TABLE character_abilities;
      DROP TABLE characters;
    `)
  }
}
