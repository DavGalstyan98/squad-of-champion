import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { z } from 'zod'
import type { Environment } from '../config/environment'
import { unauthorized } from '../common/api-exception'

const claimsSchema = z.object({ sub: z.uuid(), exp: z.number().int(), iat: z.number().int() })

@Injectable()
export class TokenService {
  readonly expiresIn: number

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Environment, true>,
  ) {
    this.expiresIn = config.get('JWT_EXPIRES_IN_SECONDS', { infer: true })
  }

  issue(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId })
  }

  async subject(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<Record<string, unknown>>(token)
      const result = claimsSchema.safeParse(claims)
      if (!result.success) throw unauthorized()
      return result.data.sub
    } catch {
      throw unauthorized()
    }
  }
}
