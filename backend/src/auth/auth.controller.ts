import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ApiErrorDto } from '../common/dto/api-error.dto'
import { UserResponseDto } from '../users/user.dto'
import { AuthService } from './auth.service'
import { CurrentUser } from './current-user'
import { JwtGuard } from './jwt.guard'
import { LoginRequestDto, LoginResponseDto, RegisterRequestDto } from './dto/auth.dto'

@ApiTags('auth')
@ApiResponse({ status: 400, description: 'VALIDATION_ERROR or BAD_REQUEST', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'CORS_ORIGIN_DENIED', type: ApiErrorDto })
@ApiResponse({ status: 500, description: 'INTERNAL_SERVER_ERROR', type: ApiErrorDto })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiResponse({
    status: 201,
    description: 'User created; login separately to obtain an access token',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_EXISTS', type: ApiErrorDto })
  register(@Body() input: RegisterRequestDto): Promise<UserResponseDto> {
    return this.auth.register(input.email, input.password)
  }

  @Post('login')
  @HttpCode(200)
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS', type: ApiErrorDto })
  login(@Body() input: LoginRequestDto): Promise<LoginResponseDto> {
    return this.auth.login(input.email, input.password)
  }

  @Get('me')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED: missing/invalid/expired token or deleted user',
    type: ApiErrorDto,
  })
  me(@CurrentUser() user: UserResponseDto): UserResponseDto {
    return user
  }
}
