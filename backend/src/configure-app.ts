import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { Environment } from './config/environment'
import { ApiException } from './common/api-exception'

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>)
  const origins = new Set(config.get('CORS_ORIGINS', { infer: true }))
  app.setGlobalPrefix('api/v1')
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || origins.has(origin)) callback(null, true)
      else callback(new ApiException(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed'))
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
  app.enableShutdownHooks()
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Squad of Champions API')
    .setDescription(
      'Authentication, public catalogue, dependency health and owned squads with server-computed statistics.',
    )
    .setVersion('1')
    .addBearerAuth()
    .build()
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig))
}
