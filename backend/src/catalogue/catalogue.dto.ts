import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const integer = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value
const values = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? [value] : value
export class CatalogueQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1, maximum: 1000000 })
  @IsOptional()
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1
  @ApiPropertyOptional({ type: 'integer', default: 24, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 24
  @ApiPropertyOptional({
    description: 'Trimmed case-insensitive literal name substring; % _ and backslash are literal.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search = ''
  @ApiPropertyOptional({
    type: [String],
    description: 'Repeat universe parameter; OR within universes. Exact metadata values.',
  })
  @IsOptional()
  @Transform(values)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  universe: string[] = []
  @ApiPropertyOptional({
    type: [String],
    description:
      'Repeat tags parameter; AND within tags, AND across categories. Exact metadata values.',
  })
  @IsOptional()
  @Transform(values)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags: string[] = []
  @ApiPropertyOptional({ enum: ['source', 'name_asc', 'name_desc'], default: 'source' })
  @IsOptional()
  @IsIn(['source', 'name_asc', 'name_desc'])
  sort: 'source' | 'name_asc' | 'name_desc' = 'source'
}
export class CharacterIdDto {
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  id!: number
}
export class AbilityDto {
  @ApiProperty({ enum: ['Mobility', 'Technique', 'Survivability', 'Power', 'Energy'] })
  abilityName!: string
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 10 }) abilityScore!: number
}
export class TagDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 3 }) slot!: number
  @ApiProperty() tag_name!: string
}
export class CharacterDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 }) id!: number
  @ApiProperty() name!: string
  @ApiProperty({ type: String, nullable: true }) quote!: string | null
  @ApiProperty() image!: string
  @ApiProperty({ type: String, nullable: true }) thumbnail!: string | null
  @ApiProperty() universe!: string
  @ApiProperty({ type: [AbilityDto], description: 'Original ability scores, in source ordering.' })
  abilities!: AbilityDto[]
  @ApiProperty({
    type: [TagDto],
    description: 'Original tags ordered by slot; missing source tags become [].',
  })
  tags!: TagDto[]
}
export class PageMetaDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1000000 }) page!: number
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 }) limit!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) total!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) totalPages!: number
}
export class CharacterPageDto {
  @ApiProperty({ type: [CharacterDto] }) data!: CharacterDto[]
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto
}
export class FiltersDto {
  @ApiProperty({ type: [String] }) universes!: string[]
  @ApiProperty({ type: [String] }) tags!: string[]
}
export function normalizeQuery(query: CatalogueQueryDto): CatalogueQueryDto {
  return {
    page: query.page,
    limit: query.limit,
    search: query.search.trim().toLowerCase(),
    universe: [...new Set(query.universe)].sort(),
    tags: [...new Set(query.tags)].sort(),
    sort: query.sort,
  }
}
