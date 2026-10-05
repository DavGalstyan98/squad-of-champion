export interface Result {
  status: number
  body: unknown
}

export interface DomainError {
  statusCode: number
  error: string
  message: string
  details?: unknown
}
