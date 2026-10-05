import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { unauthorized } from '../common/api-exception'
import { UsersService } from '../users/users.service'
import { TokenService } from './token.service'
import type { AuthenticatedRequest } from './auth.types'

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const header = request.headers.authorization
    const match =
      header && header.length <= 4096
        ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)
        : null
    if (!match?.[1]) throw unauthorized()
    const user = await this.users.findById(await this.tokens.subject(match[1]))
    if (!user) throw unauthorized()
    request.user = user
    return true
  }
}
