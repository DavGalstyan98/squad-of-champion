import { Injectable } from '@nestjs/common'
import { invalidCredentials } from '../common/api-exception'
import { UsersService } from '../users/users.service'
import { UserResponseDto } from '../users/user.dto'
import { LoginResponseDto } from './dto/auth.dto'
import { PasswordService } from './password.service'
import { TokenService } from './token.service'

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(email: string, password: string): Promise<UserResponseDto> {
    return this.users.create(email, await this.passwords.hash(password))
  }

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const credentials = await this.users.findCredentialsByEmail(email)
    const valid = await this.passwords.verify(password, credentials?.passwordHash)
    if (!credentials || !valid) throw invalidCredentials()
    return {
      accessToken: await this.tokens.issue(credentials.user.id),
      tokenType: 'Bearer',
      expiresIn: this.tokens.expiresIn,
      user: credentials.user,
    }
  }
}
