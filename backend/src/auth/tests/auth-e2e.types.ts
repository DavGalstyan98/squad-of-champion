export interface HttpResult {
  status: number
  body: Record<string, unknown>
  headers: Headers
}
