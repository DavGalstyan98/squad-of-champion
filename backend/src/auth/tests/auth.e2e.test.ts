import type { HttpResult } from './auth-e2e.types'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { inspect } from 'node:util'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import type { DataSource } from 'typeorm'
import { createDataSource, databaseUrl } from '../../database/data-source'
import { configureApp } from '../../configure-app'

function assertError(result: HttpResult, status: number, code: string): void {
  assert.equal(result.status, status)
  assert.equal(result.body.statusCode, status)
  assert.equal(result.body.error, code)
  assert.ok(typeof result.body.message === 'string')
  assert.ok(
    Object.keys(result.body).every((key) =>
      ['statusCode', 'error', 'message', 'details'].includes(key),
    ),
  )
}

function assertPublicUser(body: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(body).sort(), ['createdAt', 'email', 'id'])
  assert.ok(
    typeof body.id === 'string' &&
      typeof body.email === 'string' &&
      typeof body.createdAt === 'string',
  )
}

test(
  'auth HTTP e2e against a uniquely created PostgreSQL database',
  { timeout: 120000 },
  async (t) => {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Auth e2e refuses NODE_ENV=production')
    const adminUrl = databaseUrl(process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL)
    const name = `squad_auth_test_${randomUUID().replaceAll('-', '')}`
    const url = new URL(adminUrl)
    url.pathname = `/${name}`
    const secret = randomBytes(64).toString('hex')
    const logMessages: string[] = []
    const captureLog = (...values: unknown[]): void => {
      logMessages.push(
        values.map((value) => (typeof value === 'string' ? value : inspect(value))).join(' '),
      )
    }
    const forbiddenLogValues = [
      secret,
      '$argon2id$',
      'sensitive SQL failure',
      'untrusted-secret-value',
    ]
    const overrides = {
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      JWT_SECRET: secret,
      JWT_ALGORITHM: 'HS256',
      JWT_EXPIRES_IN_SECONDS: '120',
      JWT_ISSUER: 'squad-test-issuer',
      JWT_AUDIENCE: 'squad-test-audience',
      CORS_ORIGINS: 'http://localhost:3000,https://frontend.example.com',
      REDIS_URL: 'redis://localhost:6379',
    }
    const original = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    )
    const admin = await createDataSource(adminUrl).initialize()
    let database: DataSource | undefined
    let app: INestApplication | undefined
    let created = false
    try {
      await admin.query(`CREATE DATABASE "${name}"`)
      created = true
      database = await createDataSource(url.toString()).initialize()
      const db = database
      await db.runMigrations()
      Object.assign(process.env, overrides)
      // Import after test config is supplied so ConfigModule never binds production config.
      const { AppModule } = await import('../../app.module')
      app = await NestFactory.create(AppModule, {
        logger: {
          log: captureLog,
          error: captureLog,
          warn: captureLog,
          debug: captureLog,
          verbose: captureLog,
          fatal: captureLog,
        },
        abortOnError: false,
      })
      configureApp(app)
      await app.listen(0, '127.0.0.1')
      const base = await app.getUrl()
      const jwt = app.get(JwtService)
      const request = async (path: string, options: RequestInit = {}): Promise<HttpResult> => {
        const response = await fetch(`${base}${path}`, options)
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
          headers: response.headers,
        }
      }
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        request(`/api/v1/auth/${path}`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json', ...headers },
        })
      const me = (token?: string, headers: Record<string, string> = {}) =>
        request('/api/v1/auth/me', {
          headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        })
      const password = '  MiXeD e2e password  '
      forbiddenLogValues.push(password)
      let userId = ''
      let accessToken = ''

      await t.test(
        'registration returns public user and stores a verifiable Argon2id hash',
        async () => {
          const response = await post('register', { email: ' Player@Example.COM ', password })
          assert.equal(response.status, 201)
          assertPublicUser(response.body)
          assert.equal(response.body.email, 'player@example.com')
          userId = response.body.id as string
          const [row] = await db.query<{ password_hash: string }[]>(
            'SELECT password_hash FROM users WHERE id = $1',
            [userId],
          )
          assert.ok(row)
          assert.ok(row.password_hash.startsWith('$argon2id$'))
          forbiddenLogValues.push(row.password_hash)
          assert.ok(row.password_hash !== password)
          assert.ok(await argon2.verify(row.password_hash, password))
          assert.ok(
            !JSON.stringify(response.body).includes(password) &&
              !JSON.stringify(response.body).includes(row.password_hash),
          )
        },
      )

      await t.test(
        'login issues configured JWT and /me loads fresh user data from PostgreSQL',
        async () => {
          const response = await post('login', { email: ' PLAYER@example.com ', password })
          assert.equal(response.status, 200)
          assert.deepEqual(Object.keys(response.body).sort(), [
            'accessToken',
            'expiresIn',
            'tokenType',
            'user',
          ])
          assert.equal(response.body.tokenType, 'Bearer')
          assert.equal(response.body.expiresIn, 120)
          assert.ok(typeof response.body.accessToken === 'string')
          accessToken = response.body.accessToken
          forbiddenLogValues.push(accessToken)
          const claims = await jwt.verifyAsync<Record<string, unknown>>(accessToken)
          assert.equal(claims.sub, userId)
          assert.equal(claims.iss, overrides.JWT_ISSUER)
          assert.equal(claims.aud, overrides.JWT_AUDIENCE)
          assert.equal(Number(claims.exp) - Number(claims.iat), 120)
          const current = await me(accessToken)
          assert.equal(current.status, 200)
          assertPublicUser(current.body)
          assert.equal(current.body.id, userId)
          await db.query('UPDATE users SET email = $1 WHERE id = $2', [
            'renamed@example.com',
            userId,
          ])
          assert.equal((await me(accessToken)).body.email, 'renamed@example.com')
          await db.query('UPDATE users SET email = $1 WHERE id = $2', [
            'player@example.com',
            userId,
          ])
        },
      )

      await t.test(
        'email variants conflict and concurrent registrations create exactly one account',
        async () => {
          assertError(
            await post('register', { email: 'PLAYER@EXAMPLE.COM', password }),
            409,
            'EMAIL_ALREADY_EXISTS',
          )
          const results = await Promise.all([
            post('register', { email: ' RACE@example.com ', password }),
            post('register', { email: 'race@EXAMPLE.COM', password }),
          ])
          assert.deepEqual(results.map((result) => result.status).sort(), [201, 409])
          assertError(results.find((result) => result.status === 409)!, 409, 'EMAIL_ALREADY_EXISTS')
          const [count] = await db.query<{ count: number }[]>(
            'SELECT count(*)::integer AS count FROM users WHERE email = $1',
            ['race@example.com'],
          )
          assert.equal(count?.count, 1)
        },
      )

      await t.test(
        'wrong password and unknown email have the same credentials error; password is untouched',
        async () => {
          const wrong = await post('login', {
            email: 'player@example.com',
            password: 'wrong-password',
          })
          const unknown = await post('login', {
            email: 'unknown@example.com',
            password: 'wrong-password',
          })
          assertError(wrong, 401, 'INVALID_CREDENTIALS')
          assertError(unknown, 401, 'INVALID_CREDENTIALS')
          assert.deepEqual(wrong.body, unknown.body)
          assertError(
            await post('login', { email: 'player@example.com', password: password.trim() }),
            401,
            'INVALID_CREDENTIALS',
          )
          assertError(
            await post('login', { email: 'player@example.com', password: password.toLowerCase() }),
            401,
            'INVALID_CREDENTIALS',
          )
        },
      )

      await t.test(
        'missing, expired, tampered, wrong issuer/audience/algorithm and invalid claims rejected',
        async () => {
          const parts = accessToken.split('.')
          parts[2] = `${parts[2]![0] === 'A' ? 'B' : 'A'}${parts[2]!.slice(1)}`
          const invalidTokens = [
            undefined,
            parts.join('.'),
            'not-a-token',
            await jwt.signAsync({ sub: userId }, { expiresIn: -1 }),
            await jwt.signAsync({ sub: userId }, { issuer: 'other-issuer' }),
            await jwt.signAsync({ sub: userId }, { audience: 'other-audience' }),
            await jwt.signAsync({ sub: userId }, { algorithm: 'HS384' }),
            await new JwtService({
              secret,
              signOptions: { issuer: overrides.JWT_ISSUER, audience: overrides.JWT_AUDIENCE },
            }).signAsync({ sub: userId }),
            await jwt.signAsync({ sub: 'invalid-subject' }),
            await new JwtService({ secret: randomBytes(64).toString('hex') }).signAsync({
              sub: userId,
            }),
          ]
          for (const token of invalidTokens) assertError(await me(token), 401, 'UNAUTHORIZED')
          assertError(
            await request('/api/v1/auth/me', { headers: { Authorization: 'Basic invalid' } }),
            401,
            'UNAUTHORIZED',
          )
        },
      )

      await t.test('deleted-user token is rejected', async () => {
        const registered = await post('register', { email: 'deleted@example.com', password })
        assert.equal(registered.status, 201)
        const token = await jwt.signAsync({ sub: registered.body.id })
        await db.query('DELETE FROM users WHERE id = $1', [registered.body.id])
        assertError(await me(token), 401, 'UNAUTHORIZED')
      })

      await t.test(
        'invalid types, sizes and unknown properties rejected without submitted values',
        async () => {
          const cases = [
            {},
            [],
            [{}],
            { email: 'invalid', password },
            { email: 123, password },
            { email: 'player@example.com', password: 'short' },
            { email: 'player@example.com', password: 'x'.repeat(129) },
            { email: 'player@example.com', password: 123456789 },
            { email: 'player@example.com', password, unexpected: 'untrusted-secret-value' },
            { email: 'player@example.com', password, passwordHash: 'untrusted-secret-value' },
          ]
          for (const path of ['register', 'login']) {
            for (const body of cases) {
              const response = await post(path, body)
              assertError(response, 400, 'VALIDATION_ERROR')
              assert.ok(!JSON.stringify(response.body).includes(password))
              assert.ok(!JSON.stringify(response.body).includes('untrusted-secret-value'))
              assert.ok(!JSON.stringify(response.body).includes(secret))
            }
          }
          const malformed = await request('/api/v1/auth/login', {
            method: 'POST',
            body: '{"password":',
            headers: { 'Content-Type': 'application/json' },
          })
          assertError(malformed, 400, 'BAD_REQUEST')
          assertError(await request('/api/v1/not-a-route'), 404, 'NOT_FOUND')
        },
      )

      await t.test(
        'allowed CORS origins/preflight work and denied origin writes are blocked',
        async () => {
          for (const origin of ['http://localhost:3000', 'https://frontend.example.com']) {
            const response = await me(accessToken, { Origin: origin })
            assert.equal(response.status, 200)
            assert.equal(response.headers.get('access-control-allow-origin'), origin)
            const preflight = await fetch(`${base}/api/v1/auth/login`, {
              method: 'OPTIONS',
              headers: {
                Origin: origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type,authorization',
              },
            })
            assert.equal(preflight.status, 204)
            assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
          }
          for (const origin of [
            'https://untrusted.example.com',
            'http://localhost:3000.evil.test',
          ]) {
            const response = await post(
              'register',
              { email: 'cors-denied@example.com', password },
              { Origin: origin },
            )
            assertError(response, 403, 'CORS_ORIGIN_DENIED')
            assert.equal(response.headers.get('access-control-allow-origin'), null)
          }
          const [count] = await db.query<{ count: number }[]>(
            'SELECT count(*)::integer AS count FROM users WHERE email = $1',
            ['cors-denied@example.com'],
          )
          assert.equal(count?.count, 0)
        },
      )

      await t.test(
        'unexpected database errors return generic 500 without hashes/passwords/SQL',
        async () => {
          await db.query(`
        CREATE FUNCTION fail_auth_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'sensitive SQL failure'; END $$;
        CREATE TRIGGER fail_auth_insert BEFORE INSERT ON users FOR EACH ROW
        WHEN (NEW.email = 'failure@example.com') EXECUTE FUNCTION fail_auth_insert();
      `)
          try {
            const response = await post('register', { email: 'failure@example.com', password })
            assertError(response, 500, 'INTERNAL_SERVER_ERROR')
            for (const marker of [
              password,
              secret,
              '$argon2id$',
              'sensitive SQL failure',
              'INSERT INTO',
              'parameters',
            ]) {
              assert.ok(!JSON.stringify(response.body).includes(marker))
            }
          } finally {
            await db.query(
              'DROP TRIGGER fail_auth_insert ON users; DROP FUNCTION fail_auth_insert()',
            )
          }
        },
      )

      await t.test(
        'Swagger documents auth DTOs, bearer security and errors only for implemented routes',
        async () => {
          const response = await request('/api/docs-json')
          assert.equal(response.status, 200)
          const spec = response.body as {
            paths: Record<
              string,
              {
                get?: { security: unknown[]; responses: Record<string, unknown> }
                post?: { responses: Record<string, unknown> }
              }
            >
            components: {
              schemas: Record<string, { properties: Record<string, { writeOnly?: boolean }> }>
              securitySchemes: Record<string, { scheme: string }>
            }
          }
          assert.deepEqual(Object.keys(spec.paths).sort(), [
            '/api/v1/auth/login',
            '/api/v1/auth/me',
            '/api/v1/auth/register',
            '/api/v1/characters',
            '/api/v1/characters/filters',
            '/api/v1/characters/{id}',
            '/api/v1/health',
            '/api/v1/squads',
            '/api/v1/squads/{id}',
            '/api/v1/squads/{id}/characters/{characterId}',
          ])
          assert.equal(spec.components.securitySchemes.bearer?.scheme, 'bearer')
          assert.ok(spec.paths['/api/v1/auth/me']?.get?.security.length)
          assert.ok(spec.paths['/api/v1/auth/register']?.post?.responses['409'])
          assert.ok(spec.paths['/api/v1/auth/login']?.post?.responses['401'])
          assert.ok(spec.components.schemas.RegisterRequestDto?.properties.password?.writeOnly)
          assert.ok(spec.components.schemas.ApiErrorDto?.properties.error)
        },
      )
      await t.test(
        'runtime application logs contain no password, hash, token, secret or SQL exception',
        () => {
          assert.ok(logMessages.length > 0, 'Application logger must be exercised')
          for (const value of forbiddenLogValues)
            assert.ok(!logMessages.some((message) => message.includes(value)))
        },
      )
    } finally {
      if (app) await app.close()
      if (database?.isInitialized) await database.destroy()
      if (created) await admin.query(`DROP DATABASE "${name}"`)
      await admin.destroy()
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  },
)
