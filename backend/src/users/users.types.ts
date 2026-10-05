import type { UserResponseDto } from './user.dto'

export interface UserRow {
  id: string
  email: string
  created_at: Date
}

export interface UserCredentials {
  user: UserResponseDto
  passwordHash: string
}

export interface UserCredentialsRow extends UserRow {
  password_hash: string
}
