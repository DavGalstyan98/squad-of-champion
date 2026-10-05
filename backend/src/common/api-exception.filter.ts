import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ApiException } from './api-exception'
import type { ApiErrorDto } from './dto/api-error.dto'

const httpErrors: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Invalid request'],
  401: ['UNAUTHORIZED', 'Authentication required'],
  403: ['FORBIDDEN', 'Access denied'],
  404: ['NOT_FOUND', 'Resource not found'],
  405: ['METHOD_NOT_ALLOWED', 'Method not allowed'],
  413: ['PAYLOAD_TOO_LARGE', 'Request body is too large'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type'],
  429: ['TOO_MANY_REQUESTS', 'Too many requests'],
  500: ['INTERNAL_SERVER_ERROR', 'Internal server error'],
  503: ['SERVICE_UNAVAILABLE', 'Service unavailable'],
}

export function errorBody(exception: unknown): ApiErrorDto {
  if (exception instanceof ApiException) return exception.body
  const statusCode = exception instanceof HttpException ? exception.getStatus() : 500
  const [error, message] = httpErrors[statusCode] ?? ['HTTP_ERROR', 'Request failed']
  // Never reflect exception text, database parameters, request bodies or headers.
  return { statusCode, error, message }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = errorBody(exception)
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), body, body.statusCode)
  }
}
