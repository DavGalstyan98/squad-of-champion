import type { Request } from 'express'
import type { UserResponseDto } from '../users/user.dto'

export interface AuthenticatedRequest extends Request {
  user?: UserResponseDto
}
