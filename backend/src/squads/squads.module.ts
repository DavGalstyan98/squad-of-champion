import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SquadsController } from './squads.controller'
import { SquadsService } from './squads.service'
@Module({ imports: [AuthModule], controllers: [SquadsController], providers: [SquadsService] })
export class SquadsModule {}
