import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { CharacterDto } from '../catalogue/catalogue.dto'
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value
export class CreateSquadDto {
  @ApiProperty({ minLength: 1, maxLength: 100, description: 'Trimmed nonblank squad name.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'integer', minimum: 1, maximum: 2147483647 },
    maxItems: 6,
    uniqueItems: true,
    description: 'Original character IDs in desired member order; omitted means empty.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  characterIds?: number[]
}
export class PatchSquadDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 100,
    description: 'Rename only, replace only, or both. Empty body rejected.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'integer', minimum: 1, maximum: 2147483647 },
    maxItems: 6,
    uniqueItems: true,
    description: 'Atomically replace the entire member list; [] clears it, order is preserved.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  characterIds?: number[]
}
export class SquadIdDto {
  @IsUUID() id!: string
}
export class MemberIdDto extends SquadIdDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(2147483647)
  characterId!: number
}
export class SquadMemberDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 6 }) position!: number
  @ApiProperty({ type: CharacterDto }) character!: CharacterDto
}
export class AbilityAveragesDto {
  @ApiProperty({ type: Number, nullable: true }) Mobility!: number | null
  @ApiProperty({ type: Number, nullable: true }) Technique!: number | null
  @ApiProperty({ type: Number, nullable: true }) Survivability!: number | null
  @ApiProperty({ type: Number, nullable: true }) Power!: number | null
  @ApiProperty({ type: Number, nullable: true }) Energy!: number | null
}
export class SquadStatisticsDto {
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 6 }) memberCount!: number
  @ApiProperty({
    type: AbilityAveragesDto,
    description:
      'Unrounded arithmetic mean of original persisted scores per ability; all null when empty.',
  })
  averages!: AbilityAveragesDto
}
export class SquadDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiProperty({ format: 'date-time' }) createdAt!: string
  @ApiProperty({ format: 'date-time' }) updatedAt!: string
  @ApiProperty({
    type: [SquadMemberDto],
    description: 'Members in deterministic position order; no owner/password fields.',
  })
  members!: SquadMemberDto[]
  @ApiProperty({ type: SquadStatisticsDto }) statistics!: SquadStatisticsDto
}
