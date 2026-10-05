import type { User } from '../../shared/api/contracts'

export interface SessionState {
  token: string | null
  user: User | null
  status: 'anonymous' | 'restoring' | 'authenticated' | 'unavailable'
  notice: string | null
  epoch: number
}
