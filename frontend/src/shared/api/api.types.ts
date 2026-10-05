import type { SessionState } from '../../features/auth/session.types'

export interface State {
  session: SessionState
}

export interface SquadKey {
  ownerId: string
  id: string
}
