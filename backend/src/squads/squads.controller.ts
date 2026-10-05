import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { JwtGuard } from '../auth/jwt.guard'
import { CurrentUser } from '../auth/current-user'
import type { UserResponseDto } from '../users/user.dto'
import { ApiErrorDto } from '../common/dto/api-error.dto'
import { CreateSquadDto, MemberIdDto, PatchSquadDto, SquadDto, SquadIdDto } from './squads.dto'
import { SquadsService } from './squads.service'
@ApiTags('squads')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@ApiResponse({
  status: 400,
  type: ApiErrorDto,
  description:
    'VALIDATION_ERROR: invalid body/UUID/character ID, empty PATCH, duplicate IDs or more than six initial/replacement IDs.',
})
@ApiResponse({
  status: 401,
  type: ApiErrorDto,
  description: 'UNAUTHORIZED: missing/invalid JWT or deleted user.',
})
@ApiResponse({ status: 403, type: ApiErrorDto, description: 'CORS_ORIGIN_DENIED' })
@ApiResponse({
  status: 404,
  type: ApiErrorDto,
  description:
    'SQUAD_NOT_FOUND for missing/nonowned squad; CHARACTER_NOT_FOUND; SQUAD_MEMBER_NOT_FOUND.',
})
@ApiResponse({
  status: 409,
  type: ApiErrorDto,
  description:
    'SQUAD_FULL, CHARACTER_ALREADY_IN_SQUAD or database SQUAD_CONFLICT; 409 is the documented choice over the PDF illustrative 422.',
})
@ApiResponse({
  status: 503,
  type: ApiErrorDto,
  description:
    'SQUAD_BUSY: lock/statement deadline or transaction conflict; entire mutation rolled back, retry.',
})
@ApiResponse({
  status: 500,
  type: ApiErrorDto,
  description: 'INTERNAL_SERVER_ERROR; no database details.',
})
@Controller('squads')
export class SquadsController {
  constructor(private readonly squads: SquadsService) {}
  @Get()
  @ApiOkResponse({
    type: [SquadDto],
    description:
      'Own squads only, ordered by updatedAt descending then ID; one consistent snapshot with all members/statistics.',
  })
  list(@CurrentUser() user: UserResponseDto): Promise<SquadDto[]> {
    return this.squads.list(user.id)
  }
  @Post()
  @ApiResponse({
    status: 201,
    type: SquadDto,
    description: 'Squad and optional initial members commit atomically; empty squads valid.',
  })
  create(@CurrentUser() user: UserResponseDto, @Body() input: CreateSquadDto): Promise<SquadDto> {
    return this.squads.create(user.id, input)
  }
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SquadDto })
  find(@CurrentUser() user: UserResponseDto, @Param() params: SquadIdDto): Promise<SquadDto> {
    return this.squads.find(user.id, params.id)
  }
  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    type: SquadDto,
    description:
      'Rename and/or full replacement atomically; input ID order becomes position order.',
  })
  patch(
    @CurrentUser() user: UserResponseDto,
    @Param() params: SquadIdDto,
    @Body() input: PatchSquadDto,
  ): Promise<SquadDto> {
    return this.squads.patch(user.id, params.id, input)
  }
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Owned squad and members deleted atomically.' })
  delete(@CurrentUser() user: UserResponseDto, @Param() params: SquadIdDto): Promise<void> {
    return this.squads.delete(user.id, params.id)
  }
  @Post(':id/characters/:characterId')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'characterId', schema: { type: 'integer', minimum: 1, maximum: 2147483647 } })
  @ApiOkResponse({
    type: SquadDto,
    description: 'Append existing character; updated full squad with computed statistics.',
  })
  add(@CurrentUser() user: UserResponseDto, @Param() params: MemberIdDto): Promise<SquadDto> {
    return this.squads.add(user.id, params.id, params.characterId)
  }
  @Delete(':id/characters/:characterId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'characterId', schema: { type: 'integer', minimum: 1, maximum: 2147483647 } })
  @ApiOkResponse({
    type: SquadDto,
    description:
      'Remove member, compact positions preserving remaining order, return updated squad; absent member is 404.',
  })
  remove(@CurrentUser() user: UserResponseDto, @Param() params: MemberIdDto): Promise<SquadDto> {
    return this.squads.remove(user.id, params.id, params.characterId)
  }
}
