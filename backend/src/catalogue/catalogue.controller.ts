import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiOkResponse, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ApiErrorDto } from '../common/dto/api-error.dto'
import { CatalogueService } from './catalogue.service'
import {
  CatalogueQueryDto,
  CharacterIdDto,
  CharacterDto,
  CharacterPageDto,
  FiltersDto,
} from './catalogue.dto'
@ApiTags('characters')
@ApiResponse({
  status: 400,
  type: ApiErrorDto,
  description: 'VALIDATION_ERROR or INVALID_FILTER; unknown query fields/values rejected.',
})
@ApiResponse({ status: 403, type: ApiErrorDto, description: 'Origin denied by CORS allowlist.' })
@ApiResponse({
  status: 500,
  type: ApiErrorDto,
  description: 'Unexpected failure; no internal details.',
})
@Controller('characters')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}
  @Get()
  @ApiOkResponse({
    type: CharacterPageDto,
    description:
      'Public catalogue; source order by default, ID tie-breaker for every sort. Beyond-last page is empty.',
  })
  list(@Query() query: CatalogueQueryDto): Promise<CharacterPageDto> {
    return this.catalogue.list(query)
  }
  // Static route precedes dynamic ID route.
  @Get('filters')
  @ApiOkResponse({
    type: FiltersDto,
    description: 'Complete catalogue metadata, unaffected by current page or filters.',
  })
  filters(): Promise<FiltersDto> {
    return this.catalogue.filters()
  }
  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'integer', minimum: 1, maximum: 2147483647 } })
  @ApiOkResponse({ type: CharacterDto })
  @ApiResponse({ status: 404, type: ApiErrorDto, description: 'CHARACTER_NOT_FOUND' })
  find(@Param() params: CharacterIdDto): Promise<CharacterDto> {
    return this.catalogue.find(params.id)
  }
}
