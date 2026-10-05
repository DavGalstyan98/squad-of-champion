import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateEnvironment } from './config/environment'
import { DatabaseModule } from './database/database.module'
import { SharedApiModule } from './common/shared-api.module'
import { CatalogueModule } from './catalogue/catalogue.module'
import { SquadsModule } from './squads/squads.module'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    SharedApiModule,
    AuthModule,
    CatalogueModule,
    HealthModule,
    SquadsModule,
  ],
})
export class AppModule {}
