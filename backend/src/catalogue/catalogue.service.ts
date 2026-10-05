import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, EntityManager } from 'typeorm'
import { CacheService } from '../cache/cache.service'
import { mapCharacters } from './character-mapper'
import type { CharacterRow } from './character.types'
import { ApiException } from '../common/api-exception'
import {
  CatalogueQueryDto,
  CharacterDto,
  CharacterPageDto,
  FiltersDto,
  normalizeQuery,
} from './catalogue.dto'

@Injectable()
export class CatalogueService {
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly cache: CacheService,
  ) {}
  private snapshot<T>(read: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.database.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY')
      return read(manager)
    })
  }
  private async revision(manager: EntityManager): Promise<string> {
    const rows: { revision: string }[] = await manager.query(
      'SELECT revision::text FROM catalog_state WHERE id = 1',
    )
    if (!rows[0]) throw new Error('Catalogue state unavailable')
    return rows[0].revision
  }
  private async metadata(manager: EntityManager): Promise<FiltersDto> {
    const universes: { value: string }[] = await manager.query(
      'SELECT DISTINCT universe AS value FROM characters ORDER BY value',
    )
    const tags: { value: string }[] = await manager.query(
      'SELECT DISTINCT tag_name AS value FROM character_tags ORDER BY value',
    )
    return { universes: universes.map((row) => row.value), tags: tags.map((row) => row.value) }
  }
  async filters(): Promise<FiltersDto> {
    return this.snapshot(async (manager) => {
      const key = this.cache.key(await this.revision(manager), 'filters')
      const cached = await this.cache.get<FiltersDto>(key)
      if (cached) return cached
      const result = await this.metadata(manager)
      await this.cache.set(key, result)
      return result
    })
  }
  async list(input: CatalogueQueryDto): Promise<CharacterPageDto> {
    const query = normalizeQuery(input)
    return this.snapshot(async (manager) => {
      const revision = await this.revision(manager)
      const key = this.cache.key(revision, 'characters', query)
      const cached = await this.cache.get<CharacterPageDto>(key)
      if (cached) return cached
      const metadataKey = this.cache.key(revision, 'filters')
      const metadata =
        (await this.cache.get<FiltersDto>(metadataKey)) ?? (await this.metadata(manager))
      if (
        query.universe.some((value) => !metadata.universes.includes(value)) ||
        query.tags.some((value) => !metadata.tags.includes(value))
      ) {
        throw new ApiException(400, 'INVALID_FILTER', 'Unknown universe or tag filter')
      }
      const parameters: unknown[] = []
      const predicates: string[] = []
      const param = (value: unknown): string => {
        parameters.push(value)
        return '$' + parameters.length
      }
      if (query.search)
        predicates.push(
          `lower(c.name) LIKE ${param('%' + query.search.replace(/[\\%_]/g, '\\$&') + '%')} ESCAPE E'\\\\'`,
        )
      if (query.universe.length)
        predicates.push(`c.universe = ANY(${param(query.universe)}::text[])`)
      for (const tag of query.tags)
        predicates.push(
          `EXISTS (SELECT 1 FROM character_tags t WHERE t.character_id = c.id AND t.tag_name = ${param(tag)})`,
        )
      const where = predicates.length ? 'WHERE ' + predicates.join(' AND ') : ''
      const counts: { total: string }[] = await manager.query(
        `SELECT count(*)::text AS total FROM characters c ${where}`,
        parameters,
      )
      const total = Number(counts[0]?.total ?? 0)
      const order = {
        source: 'c.source_order ASC, c.id ASC',
        name_asc: 'lower(c.name) ASC, c.id ASC',
        name_desc: 'lower(c.name) DESC, c.id ASC',
      }[query.sort]
      const rows: CharacterRow[] = await manager.query(
        `SELECT c.id, c.name, c.quote, c.image, c.thumbnail, c.universe FROM characters c ${where} ORDER BY ${order} LIMIT ${param(query.limit)} OFFSET ${param((query.page - 1) * query.limit)}`,
        parameters,
      )
      const result = {
        data: await mapCharacters(manager, rows),
        meta: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      }
      await this.cache.set(key, result)
      return result
    })
  }
  async find(id: number): Promise<CharacterDto> {
    return this.snapshot(async (manager) => {
      const rows: CharacterRow[] = await manager.query(
        'SELECT id, name, quote, image, thumbnail, universe FROM characters WHERE id = $1',
        [id],
      )
      const character = (await mapCharacters(manager, rows))[0]
      if (!character) throw new ApiException(404, 'CHARACTER_NOT_FOUND', 'Character not found')
      return character
    })
  }
}
