export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('data' in error) {
      const data = error.data
      if (
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof data.message === 'string'
      )
        return data.message
    }
    if ('status' in error && ['FETCH_ERROR', 'TIMEOUT_ERROR'].includes(String(error.status)))
      return 'Cannot reach the server. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}
