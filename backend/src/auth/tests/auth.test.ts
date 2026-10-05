import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PasswordService } from '../password.service'
import { TokenService } from '../token.service'
import { normalizeEmail } from '../../users/users.service'
import { validateEnvironment } from '../../config/environment'

function environment() {
  return {
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: 'http://localhost:3000',
    JWT_SECRET: randomBytes(64).toString('hex'),
  }
}

test('Argon2id hashes are salted, verifiable and preserve password case and whitespace', async () => {
  const service = new PasswordService()
  await service.onModuleInit()
  const password = '  MiXeD test password  '
  const first = await service.hash(password)
  const second = await service.hash(password)
  assert.ok(first.startsWith('$argon2id$v=19$m=65536,t=3,p=1$'))
  assert.ok(first !== password && first !== second)
  assert.ok(await service.verify(password, first))
  assert.ok(!(await service.verify(password.trim(), first)))
  assert.ok(!(await service.verify(password.toLowerCase(), first)))
  assert.ok(!(await service.verify(password)))
  assert.ok(!(await service.verify(password, 'malformed-test-hash')))
})

test('email normalization changes email only', () => {
  assert.equal(normalizeEmail('  Player@Example.COM  '), 'player@example.com')
})

test('JWT configuration rejects weak keys, unsupported algorithms and invalid lifetimes', () => {
  const input = environment()
  const valid = validateEnvironment(input)
  assert.equal(valid.JWT_ALGORITHM, 'HS256')
  assert.equal(valid.JWT_EXPIRES_IN_SECONDS, 3600)
  for (const patch of [
    { JWT_SECRET: '' },
    { JWT_SECRET: 'short' },
    { JWT_ALGORITHM: 'none' },
    { JWT_ALGORITHM: 'RS256' },
    { JWT_ALGORITHM: 'HS512', JWT_SECRET: 'x'.repeat(32) },
    { JWT_EXPIRES_IN_SECONDS: 0 },
    { JWT_EXPIRES_IN_SECONDS: 86401 },
    { JWT_ISSUER: ' ' },
    { JWT_AUDIENCE: '' },
    { CORS_ORIGINS: '*' },
    { DATABASE_URL: 'invalid-url-with-private-test-value' },
    { REDIS_URL: 'invalid-url-with-private-test-value' },
  ]) {
    assert.throws(
      () => validateEnvironment({ ...input, ...patch }),
      /Invalid environment configuration/,
    )
  }
})

test('JWT service enforces configured algorithms/claims and requires an exp and UUID subject', async () => {
  const env = validateEnvironment(environment())
  const jwt = new JwtService({
    secret: env.JWT_SECRET,
    signOptions: {
      algorithm: env.JWT_ALGORITHM,
      expiresIn: 60,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
    verifyOptions: {
      algorithms: [env.JWT_ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
  })
  const service = new TokenService(jwt, new ConfigService(env))
  const id = randomUUID()
  const token = await service.issue(id)
  assert.equal(await service.subject(token), id)
  for (const invalid of [
    await jwt.signAsync({ sub: id }, { expiresIn: -1 }),
    await jwt.signAsync({ sub: id }, { issuer: 'wrong-issuer' }),
    await jwt.signAsync({ sub: id }, { audience: 'wrong-audience' }),
    await jwt.signAsync({ sub: id }, { algorithm: 'HS384' }),
    await new JwtService({
      secret: env.JWT_SECRET,
      signOptions: { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
    }).signAsync({ sub: id }),
    await jwt.signAsync({ sub: 'not-a-uuid' }),
  ]) {
    await assert.rejects(service.subject(invalid), (error: unknown) => {
      assert.equal((error as { getStatus(): number }).getStatus(), 401)
      return true
    })
  }
})
