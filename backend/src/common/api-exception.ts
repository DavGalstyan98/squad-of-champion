import { HttpException } from '@nestjs/common'
import type { ApiErrorDto, ValidationDetailDto } from './dto/api-error.dto'

export class ApiException extends HttpException {
  readonly body: ApiErrorDto

  constructor(statusCode: number, error: string, message: string, details?: ValidationDetailDto[]) {
    const body: ApiErrorDto = { statusCode, error, message, ...(details ? { details } : {}) }
    super(body, statusCode)
    this.body = body
  }
}

export function unauthorized(): ApiException {
  return new ApiException(401, 'UNAUTHORIZED', 'Authentication required')
}

export function invalidCredentials(): ApiException {
  return new ApiException(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
}
