import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { createHash } from 'node:crypto'
import type { Environment } from '../config/environment'

@Injectable()
export class CacheService implements OnModuleDestroy {
  readonly client: Redis
  constructor(private readonly config: ConfigService<Environment, true>) {
    const timeout = config.get('REDIS_TIMEOUT_MS', { infer: true })
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      connectTimeout: timeout,
      commandTimeout: timeout,
      disconnectTimeout: timeout,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      retryStrategy: (attempt) => Math.min(attempt * 100, 1000),
    })
    // Never emit connection errors containing URLs/credentials to application logs.
    this.client.on('error', () => {})
    void this.client.connect().catch(() => {})
  }
  key(revision: string, resource: string, query?: unknown): string {
    const suffix =
      query === undefined
        ? ''
        : ':' + createHash('sha256').update(JSON.stringify(query)).digest('hex')
    return `${this.config.get('CACHE_NAMESPACE', { infer: true })}:v1:r${revision}:${resource}${suffix}`
  }
  async get<T>(key: string): Promise<T | undefined> {
    if (this.client.status !== 'ready') return undefined
    try {
      const value = await this.client.get(key)
      return value === null ? undefined : (JSON.parse(value) as T)
    } catch {
      this.client.disconnect(true)
      return undefined
    }
  }
  async set(key: string, value: unknown): Promise<void> {
    if (this.client.status !== 'ready') return
    try {
      await this.client.set(
        key,
        JSON.stringify(value),
        'EX',
        this.config.get('CACHE_TTL_SECONDS', { infer: true }),
      )
    } catch {
      this.client.disconnect(true) /* Drop timed-out commands; retry in background. */
    }
  }
  async healthy(): Promise<boolean> {
    if (this.client.status !== 'ready') return false
    try {
      return (await this.client.ping()) === 'PONG'
    } catch {
      this.client.disconnect(true)
      return false
    }
  }
  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') return
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        this.client.off('end', finish)
        resolve()
      }
      const timer = setTimeout(finish, this.config.get('REDIS_TIMEOUT_MS', { infer: true }) * 2)
      this.client.once('end', finish)
      this.client.disconnect()
    })
  }
}
