import { z } from 'zod'

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          URL.canParse(value) && ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      ),
    REDIS_URL: z
      .url()
      .refine(
        (value) => URL.canParse(value) && ['redis:', 'rediss:'].includes(new URL(value).protocol),
      ),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86400).default(300),
    CACHE_NAMESPACE: z
      .string()
      .regex(/^[a-zA-Z0-9:_-]{1,100}$/)
      .default('catalog'),
    REDIS_TIMEOUT_MS: z.coerce.number().int().min(50).max(2000).default(200),
    HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(1000),
    SQUAD_LOCK_TIMEOUT_MS: z.coerce.number().int().min(50).max(10000).default(1500),
    SQUAD_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
    JWT_SECRET: z.string().min(32),
    JWT_ALGORITHM: z.enum(['HS256', 'HS384', 'HS512']).default('HS256'),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(1).max(86400).default(3600),
    JWT_ISSUER: z.string().trim().min(1).max(256).default('squad-of-champions'),
    JWT_AUDIENCE: z.string().trim().min(1).max(256).default('squad-of-champions-frontend'),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(
        z
          .array(
            z.url().refine((value) => {
              if (!URL.canParse(value)) return false
              const url = new URL(value)
              return ['http:', 'https:'].includes(url.protocol) && url.origin === value
            }),
          )
          .min(1),
      ),
  })
  .superRefine((environment, context) => {
    if (environment.SQUAD_STATEMENT_TIMEOUT_MS < environment.SQUAD_LOCK_TIMEOUT_MS)
      context.addIssue({
        code: 'custom',
        path: ['SQUAD_STATEMENT_TIMEOUT_MS'],
        message: 'Statement timeout must cover lock timeout',
      })
    const minimumBytes = { HS256: 32, HS384: 48, HS512: 64 }[environment.JWT_ALGORITHM]
    if (Buffer.byteLength(environment.JWT_SECRET, 'utf8') < minimumBytes) {
      context.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT key is too short' })
    }
  })

export type Environment = z.infer<typeof environmentSchema>

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input)
  if (!result.success) {
    // Report field names only: connection URLs can contain credentials.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`)
  }
  return result.data
}
