import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { Environment } from '../config/environment'
import { UsersModule } from '../users/users.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordService } from './password.service'
import { TokenService } from './token.service'
import { JwtGuard } from './jwt.guard'

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: config.get('JWT_ALGORITHM', { infer: true }),
          expiresIn: config.get('JWT_EXPIRES_IN_SECONDS', { infer: true }),
          issuer: config.get('JWT_ISSUER', { infer: true }),
          audience: config.get('JWT_AUDIENCE', { infer: true }),
        },
        verifyOptions: {
          algorithms: [config.get('JWT_ALGORITHM', { infer: true })],
          issuer: config.get('JWT_ISSUER', { infer: true }),
          audience: config.get('JWT_AUDIENCE', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtGuard],
  exports: [JwtGuard, TokenService, UsersModule],
})
export class AuthModule {}
