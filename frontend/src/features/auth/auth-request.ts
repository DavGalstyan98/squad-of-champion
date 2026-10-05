import { apiUrl } from '../../shared/api/config'
import type { LoginResponse } from '../../shared/api/contracts'
export async function authenticate(
  mode: 'login' | 'register',
  email: string,
  password: string,
  signal: AbortSignal,
): Promise<LoginResponse> {
  const send = async (route: string) => {
    const response = await fetch(apiUrl + '/auth/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal,
    })
    const body = await response.json()
    if (!response.ok) throw Object.assign(new Error('Authentication failed'), { data: body })
    return body
  }
  if (mode === 'register') await send('register')
  return send('login')
}
