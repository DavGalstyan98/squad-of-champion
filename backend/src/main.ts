import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import type { Environment } from './config/environment'
import { configureApp } from './configure-app'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService<Environment, true>)

  configureApp(app)

  await app.listen(config.get('PORT', { infer: true }))
}

bootstrap().catch(() => {
  // Nest logs initialization failures; avoid printing configuration values here.
  process.exitCode = 1
})
