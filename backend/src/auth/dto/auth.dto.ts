import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'
import { normalizeEmail } from '../../users/users.service'
import { UserResponseDto } from '../../users/user.dto'

class CredentialsDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string

  @ApiProperty({ format: 'password', writeOnly: true, minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string
}

export class RegisterRequestDto extends CredentialsDto {}
export class LoginRequestDto extends CredentialsDto {}

export class LoginResponseDto {
  @ApiProperty({ description: 'Access token; returned only by successful login' })
  accessToken!: string

  @ApiProperty({ enum: ['Bearer'] })
  tokenType!: 'Bearer'

  @ApiProperty({ type: 'integer', description: 'Access-token lifetime in seconds', minimum: 1 })
  expiresIn!: number

  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto
}
