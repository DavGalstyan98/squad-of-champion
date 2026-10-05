import type { UserRow, UserCredentials, UserCredentialsRow } from './users.types'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryFailedError } from 'typeorm'
import { ApiException } from '../common/api-exception'
import { UserResponseDto } from './user.dto'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function publicUser(row: UserRow): UserResponseDto {
  return { id: row.id, email: row.email, createdAt: row.created_at.toISOString() }
}

@Injectable()
export class UsersService {
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async create(email: string, passwordHash: string): Promise<UserResponseDto> {
    try {
      const result = await this.database
        .createQueryBuilder()
        .insert()
        .into('users')
        .values({ email: normalizeEmail(email), password_hash: passwordHash })
        .returning('id, email, created_at')
        .execute()
      const [row] = result.raw as UserRow[]
      if (!row) throw new Error('User insert failed')
      return publicUser(row)
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const cause = error.driverError as { code?: string; constraint?: string }
        if (cause.code === '23505' && cause.constraint === 'users_email_key') {
          throw new ApiException(409, 'EMAIL_ALREADY_EXISTS', 'Email is already registered')
        }
      }
      throw error
    }
  }

  private publicUserQuery() {
    return this.database
      .createQueryBuilder()
      .select('account.id', 'id')
      .addSelect('account.email', 'email')
      .addSelect('account.created_at', 'created_at')
      .from('users', 'account')
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const row = await this.publicUserQuery()
      .addSelect('account.password_hash', 'password_hash')
      .where('account.email = :email', { email: normalizeEmail(email) })
      .getRawOne<UserCredentialsRow>()
    return row ? { user: publicUser(row), passwordHash: row.password_hash } : null
  }

  async findById(id: string): Promise<UserResponseDto | null> {
    const row = await this.publicUserQuery().where('account.id = :id', { id }).getRawOne<UserRow>()
    return row ? publicUser(row) : null
  }
}
