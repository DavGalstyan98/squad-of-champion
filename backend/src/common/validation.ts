import { ValidationPipe } from '@nestjs/common'
import type { ValidationError } from 'class-validator'
import { ApiException } from './api-exception'
import type { ValidationDetailDto } from './dto/api-error.dto'

function details(errors: ValidationError[], parent = ''): ValidationDetailDto[] {
  return errors.flatMap((error) => {
    const property = error.property ?? '$'
    const field = parent ? `${parent}.${property}` : property
    return [
      ...(error.constraints ? [{ field, rules: Object.keys(error.constraints).sort() }] : []),
      ...details(error.children ?? [], field),
    ]
  })
}

export function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ApiException(400, 'VALIDATION_ERROR', 'Invalid request input', details(errors)),
  })
}
