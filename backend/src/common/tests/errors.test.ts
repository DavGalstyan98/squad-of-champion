import 'reflect-metadata'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BadRequestException, HttpException } from '@nestjs/common'
import { errorBody } from '../api-exception.filter'
import { ApiException, invalidCredentials } from '../api-exception'
import { validationPipe } from '../validation'
import { LoginRequestDto } from '../../auth/dto/auth.dto'

test('shared errors discard framework/SQL/exception messages and keep domain format', () => {
  const marker = 'sensitive-test-data-must-not-leak'
  for (const error of [
    new Error(marker),
    new BadRequestException(marker),
    new HttpException({ password: marker }, 403),
  ]) {
    const body = errorBody(error)
    assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'statusCode'])
    assert.ok(!JSON.stringify(body).includes(marker))
  }
  assert.deepEqual(errorBody(new Error(marker)), {
    statusCode: 500,
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error',
  })
  assert.deepEqual(errorBody(invalidCredentials()), {
    statusCode: 401,
    error: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password',
  })
})

test('DTO validation normalizes email, preserves password and rejects unknown values without echoing them', async () => {
  const pipe = validationPipe()
  const metadata = { type: 'body' as const, metatype: LoginRequestDto }
  const password = '  MiXeD test password  '
  const value = (await pipe.transform(
    { email: ' Player@Example.COM ', password },
    metadata,
  )) as LoginRequestDto
  assert.equal(value.email, 'player@example.com')
  assert.ok(value.password === password)
  for (const input of [
    { email: 'player@example.com', password, injected: 'sensitive-field-value' },
    { email: 123, password },
    { email: 'bad-email', password: 'short' },
    { email: 'player@example.com', password: 123456789 },
  ]) {
    await assert.rejects(pipe.transform(input, metadata), (error: unknown) => {
      assert.ok(error instanceof ApiException)
      assert.equal(error.body.statusCode, 400)
      assert.equal(error.body.error, 'VALIDATION_ERROR')
      const serialized = JSON.stringify(error.body)
      assert.ok(!serialized.includes(password) && !serialized.includes('sensitive-field-value'))
      assert.ok(
        error.body.details?.every(
          (detail) => Object.keys(detail).sort().join(',') === 'field,rules',
        ),
      )
      return true
    })
  }
})
