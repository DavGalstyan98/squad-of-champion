import type { AuthenticatedRequest } from './auth.types'
import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { unauthorized } from '../common/api-exception'
import type { UserResponseDto } from '../users/user.dto'

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserResponseDto => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user
    if (!user) throw unauthorized()
    return user
  },
)
