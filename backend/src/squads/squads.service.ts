import type { SquadRow, Membership, MemberRow } from './squads.types'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, EntityManager, QueryFailedError } from 'typeorm'
import type { Environment } from '../config/environment'
import { ApiException } from '../common/api-exception'
import { mapCharacters } from '../catalogue/character-mapper'
import type { CreateSquadDto, PatchSquadDto, SquadDto } from './squads.dto'
import { statistics } from './statistics'

const notFound = (): ApiException => new ApiException(404, 'SQUAD_NOT_FOUND', 'Squad not found')
const invalid = (): ApiException => new ApiException(400, 'VALIDATION_ERROR', 'Invalid squad input')

@Injectable()
export class SquadsService {
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  private async transaction<T>(
    write: boolean,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.transaction(
        write ? 'READ COMMITTED' : 'REPEATABLE READ',
        async (manager) => {
          if (!write) await manager.query('SET TRANSACTION READ ONLY')
          await manager.query(
            "SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)",
            [
              this.config.get('SQUAD_LOCK_TIMEOUT_MS', { infer: true }) + 'ms',
              this.config.get('SQUAD_STATEMENT_TIMEOUT_MS', { infer: true }) + 'ms',
            ],
          )
          // All writers use this lock order: seed-shared lock, then owner-scoped squad row.
          // Keep catalogue parent/child mapping coherent even if a seed runs concurrently.
          if (write) await manager.query('SELECT pg_advisory_xact_lock_shared(360, 1)')
          return work(manager)
        },
      )
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const failure = error.driverError as { code?: string; constraint?: string }
        if (['55P03', '57014', '40P01', '40001'].includes(failure.code ?? ''))
          throw new ApiException(
            503,
            'SQUAD_BUSY',
            'Squad operation temporarily unavailable; retry',
          )
        if (failure.code === '23503' && failure.constraint === 'squad_members_character_id_fkey')
          throw new ApiException(404, 'CHARACTER_NOT_FOUND', 'Character not found')
        if (failure.code === '23503' && failure.constraint === 'squads_owner_id_fkey')
          throw new ApiException(401, 'UNAUTHORIZED', 'Authentication required')
        if (failure.code === '23505' && failure.constraint === 'squad_members_pkey')
          throw new ApiException(409, 'CHARACTER_ALREADY_IN_SQUAD', 'Character already in squad')
        if (
          failure.code === '23505' &&
          failure.constraint === 'squad_members_squad_id_position_key'
        )
          throw new ApiException(409, 'SQUAD_CONFLICT', 'Squad membership conflict')
      }
      throw error
    }
  }
  private name(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw invalid()
    return value.trim()
  }
  private ids(values: number[]): void {
    if (
      !Array.isArray(values) ||
      values.length > 6 ||
      new Set(values).size !== values.length ||
      values.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)
    )
      throw invalid()
  }
  private async existing(manager: EntityManager, ids: number[]): Promise<void> {
    if (!ids.length) return
    const rows: { id: number }[] = await manager.query(
      'SELECT id FROM characters WHERE id = ANY($1::int[])',
      [ids],
    )
    if (rows.length !== ids.length)
      throw new ApiException(404, 'CHARACTER_NOT_FOUND', 'Character not found')
  }
  private async members(manager: EntityManager, id: string): Promise<Membership[]> {
    return manager.query(
      'SELECT character_id, position FROM squad_members WHERE squad_id = $1 ORDER BY position, character_id',
      [id],
    )
  }
  private async locked(manager: EntityManager, owner: string, id: string): Promise<SquadRow> {
    const rows: SquadRow[] = await manager.query(
      'SELECT id, name, created_at, updated_at FROM squads WHERE id = $1 AND owner_id = $2 FOR UPDATE',
      [id, owner],
    )
    if (!rows[0]) throw notFound()
    return rows[0]
  }
  private async replace(manager: EntityManager, id: string, ids: number[]): Promise<void> {
    await manager.query('DELETE FROM squad_members WHERE squad_id = $1', [id])
    if (ids.length)
      await manager.query(
        'INSERT INTO squad_members (squad_id, character_id, position) SELECT $1, member_id, ordinal::int FROM unnest($2::int[]) WITH ORDINALITY AS members(member_id, ordinal)',
        [id, ids],
      )
  }
  private async load(manager: EntityManager, rows: SquadRow[]): Promise<SquadDto[]> {
    if (!rows.length) return []
    const members: MemberRow[] = await manager.query(
      `SELECT m.squad_id, m.position, c.id, c.name, c.quote, c.image, c.thumbnail, c.universe
      FROM squad_members m JOIN characters c ON c.id = m.character_id WHERE m.squad_id = ANY($1::uuid[]) ORDER BY m.squad_id, m.position, c.id`,
      [rows.map((row) => row.id)],
    )
    const unique = [...new Map(members.map((member) => [member.id, member])).values()]
    const characters = new Map(
      (await mapCharacters(manager, unique)).map((character) => [character.id, character]),
    )
    const grouped = new Map<string, SquadDto['members']>()
    for (const member of members) {
      const group = grouped.get(member.squad_id) ?? []
      group.push({ position: member.position, character: characters.get(member.id)! })
      grouped.set(member.squad_id, group)
    }
    return rows.map((row) => {
      const members = grouped.get(row.id) ?? []
      return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        members,
        statistics: statistics(members.map((member) => member.character)),
      }
    })
  }
  async list(owner: string): Promise<SquadDto[]> {
    return this.transaction(false, async (manager) =>
      this.load(
        manager,
        await manager.query(
          'SELECT id, name, created_at, updated_at FROM squads WHERE owner_id = $1 ORDER BY updated_at DESC, id ASC',
          [owner],
        ),
      ),
    )
  }
  async find(owner: string, id: string): Promise<SquadDto> {
    return this.transaction(false, async (manager) => {
      const rows: SquadRow[] = await manager.query(
        'SELECT id, name, created_at, updated_at FROM squads WHERE id = $1 AND owner_id = $2',
        [id, owner],
      )
      if (!rows[0]) throw notFound()
      return (await this.load(manager, rows))[0]!
    })
  }
  async create(owner: string, input: CreateSquadDto): Promise<SquadDto> {
    const name = this.name(input.name)
    const ids = input.characterIds === undefined ? [] : input.characterIds
    this.ids(ids)
    return this.transaction(true, async (manager) => {
      await this.existing(manager, ids)
      const rows: SquadRow[] = await manager.query(
        'WITH inserted AS (INSERT INTO squads (owner_id, name) VALUES ($1, $2) RETURNING id, name, created_at, updated_at) SELECT * FROM inserted',
        [owner, name],
      )
      await this.replace(manager, rows[0]!.id, ids)
      return (await this.load(manager, rows))[0]!
    })
  }
  async patch(owner: string, id: string, input: PatchSquadDto): Promise<SquadDto> {
    if (input.name === undefined && input.characterIds === undefined) throw invalid()
    return this.transaction(true, async (manager) => {
      await this.locked(manager, owner, id)
      await this.members(manager, id) // Membership reads happen only after the common row lock.
      if (input.name !== undefined) this.name(input.name)
      if (input.characterIds !== undefined) {
        this.ids(input.characterIds)
        await this.existing(manager, input.characterIds)
        await this.replace(manager, id, input.characterIds)
      }
      const rows: SquadRow[] = await manager.query(
        'WITH updated AS (UPDATE squads SET name = COALESCE($3::text, name), updated_at = clock_timestamp() WHERE id = $1 AND owner_id = $2 RETURNING id, name, created_at, updated_at) SELECT * FROM updated',
        [id, owner, input.name === undefined ? null : this.name(input.name)],
      )
      return (await this.load(manager, rows))[0]!
    })
  }
  async add(owner: string, id: string, characterId: number): Promise<SquadDto> {
    return this.transaction(true, async (manager) => {
      await this.locked(manager, owner, id)
      const members = await this.members(manager, id)
      this.ids([characterId])
      await this.existing(manager, [characterId])
      if (members.some((member) => member.character_id === characterId))
        throw new ApiException(409, 'CHARACTER_ALREADY_IN_SQUAD', 'Character already in squad')
      if (members.length >= 6)
        throw new ApiException(409, 'SQUAD_FULL', 'A squad cannot have more than 6 characters')
      // Removal compacts positions; append preserves relative order of existing members.
      if (members.some((member, index) => member.position !== index + 1)) {
        // Support valid legacy/directly inserted gaps without a position collision.
        await this.replace(manager, id, [
          ...members.map((member) => member.character_id),
          characterId,
        ])
      } else {
        await manager.query(
          'INSERT INTO squad_members (squad_id, character_id, position) VALUES ($1, $2, $3)',
          [id, characterId, members.length + 1],
        )
      }
      return this.updated(manager, owner, id)
    })
  }
  private async updated(manager: EntityManager, owner: string, id: string): Promise<SquadDto> {
    const rows: SquadRow[] = await manager.query(
      'WITH updated AS (UPDATE squads SET updated_at = clock_timestamp() WHERE id = $1 AND owner_id = $2 RETURNING id, name, created_at, updated_at) SELECT * FROM updated',
      [id, owner],
    )
    return (await this.load(manager, rows))[0]!
  }
  async remove(owner: string, id: string, characterId: number): Promise<SquadDto> {
    return this.transaction(true, async (manager) => {
      await this.locked(manager, owner, id)
      const members = await this.members(manager, id)
      this.ids([characterId])
      if (!members.some((member) => member.character_id === characterId))
        throw new ApiException(404, 'SQUAD_MEMBER_NOT_FOUND', 'Squad member not found')
      await this.replace(
        manager,
        id,
        members
          .filter((member) => member.character_id !== characterId)
          .map((member) => member.character_id),
      )
      return this.updated(manager, owner, id)
    })
  }
  async delete(owner: string, id: string): Promise<void> {
    return this.transaction(true, async (manager) => {
      await this.locked(manager, owner, id)
      await this.members(manager, id)
      await manager.query('DELETE FROM squads WHERE id = $1 AND owner_id = $2', [id, owner])
    })
  }
}
