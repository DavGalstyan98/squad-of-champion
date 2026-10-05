import { ApiProperty } from '@nestjs/swagger'

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({ format: 'email' })
  email!: string

  @ApiProperty({ format: 'date-time' })
  createdAt!: string
}
