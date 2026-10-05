import { Module } from '@nestjs/common'
import { APP_FILTER, APP_PIPE } from '@nestjs/core'
import { ApiExceptionFilter } from './api-exception.filter'
import { validationPipe } from './validation'

@Module({
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: validationPipe },
  ],
})
export class SharedApiModule {}
