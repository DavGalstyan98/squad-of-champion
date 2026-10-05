import 'reflect-metadata'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { DataSource } from 'typeorm'
import { z } from 'zod'
import { databaseOptions } from './database-options'

config({ path: resolve(__dirname, '../../.env'), quiet: true })

export function databaseUrl(value: unknown = process.env.DATABASE_URL): string {
  const result = z
    .url()
    .refine(
      (url) => URL.canParse(url) && ['postgres:', 'postgresql:'].includes(new URL(url).protocol),
    )
    .safeParse(value)
  if (!result.success) throw new Error('Invalid or missing DATABASE_URL')
  return result.data
}

export function createDataSource(url = databaseUrl()): DataSource {
  return new DataSource(databaseOptions(url))
}
