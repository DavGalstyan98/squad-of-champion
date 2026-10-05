import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ValidationDetailDto {
  @ApiProperty({ description: 'Invalid field path; no submitted values' })
  field!: string

  @ApiProperty({ type: [String], description: 'Validation rule names' })
  rules!: string[]
}

export class ApiErrorDto {
  @ApiProperty({ type: 'integer', example: 401 })
  statusCode!: number

  @ApiProperty({ example: 'UNAUTHORIZED' })
  error!: string

  @ApiProperty({ example: 'Authentication required' })
  message!: string

  @ApiPropertyOptional({ type: [ValidationDetailDto] })
  details?: ValidationDetailDto[]
}
