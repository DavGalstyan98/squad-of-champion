import { Module, Injectable, Controller, Get, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiProperty, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { Client } from 'pg'
import type { Environment } from '../config/environment'
import { CacheModule } from '../cache/cache.module'
import { ApiErrorDto } from '../common/dto/api-error.dto'
import { CacheService } from '../cache/cache.service'
export class DependencyStatusDto {
  @ApiProperty({ enum: ['up', 'down'] }) postgres!: 'up' | 'down'
  @ApiProperty({ enum: ['up', 'down'] }) redis!: 'up' | 'down'
}
export class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded'
  @ApiProperty({ type: DependencyStatusDto }) dependencies!: DependencyStatusDto
}
@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly cache: CacheService,
  ) {}
  async postgres(): Promise<boolean> {
    // Dedicated bounded probe cannot queue behind exhausted application pool connections.
    const timeout = this.config.get('HEALTH_TIMEOUT_MS', { infer: true })
    const client = new Client({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      connectionTimeoutMillis: timeout,
      query_timeout: timeout,
      statement_timeout: timeout,
    })
    client.on('error', () => {})
    try {
      await client.connect()
      await client.query('SELECT 1')
      return true
    } catch {
      return false
    } finally {
      await client.end().catch(() => {})
    }
  }
  async check(): Promise<HealthDto> {
    const [postgres, redis] = await Promise.all([this.postgres(), this.cache.healthy()])
    return {
      status: postgres && redis ? 'ok' : 'degraded',
      dependencies: { postgres: postgres ? 'up' : 'down', redis: redis ? 'up' : 'down' },
    }
  }
}
@ApiResponse({ status: 403, type: ApiErrorDto, description: 'CORS_ORIGIN_DENIED' })
@ApiResponse({ status: 500, type: ApiErrorDto, description: 'INTERNAL_SERVER_ERROR' })
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get()
  @ApiOkResponse({ type: HealthDto, description: 'Both actual dependency probes succeeded.' })
  @ApiResponse({
    status: 503,
    type: HealthDto,
    description: 'At least one dependency probe failed or timed out. No secrets returned.',
  })
  async get(@Res({ passthrough: true }) response: Response): Promise<HealthDto> {
    const result = await this.health.check()
    response.status(result.status === 'ok' ? 200 : 503)
    return result
  }
}
@Module({ imports: [CacheModule], providers: [HealthService], controllers: [HealthController] })
export class HealthModule {}
