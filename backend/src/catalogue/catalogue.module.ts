import { Module } from '@nestjs/common'
import { CacheModule } from '../cache/cache.module'
import { CatalogueController } from './catalogue.controller'
import { CatalogueService } from './catalogue.service'
@Module({
  imports: [CacheModule],
  controllers: [CatalogueController],
  providers: [CatalogueService],
})
export class CatalogueModule {}
