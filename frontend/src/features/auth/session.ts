import type { SessionState } from './session.types'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { User } from '../../shared/api/contracts'
export const TOKEN_KEY = 'squad.accessToken'
export function storedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export function persistToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* Session remains in memory if storage is unavailable. */
  }
}

export const initialSession = (token: string | null): SessionState => ({
  token,
  user: null,
  status: token ? 'restoring' : 'anonymous',
  notice: null,
  epoch: 0,
})
const slice = createSlice({
  name: 'session',
  initialState: initialSession(null),
  reducers: {
    signedIn(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token
      state.user = action.payload.user
      state.status = 'authenticated'
      state.notice = null
      state.epoch++
    },
    restored(state, action: PayloadAction<User>) {
      state.user = action.payload
      state.status = 'authenticated'
      state.notice = null
      state.epoch++
    },
    signedOut(state) {
      state.token = null
      state.user = null
      state.status = 'anonymous'
      state.notice = null
      state.epoch++
    },
    expired(state) {
      state.token = null
      state.user = null
      state.status = 'anonymous'
      state.notice = 'Your session expired. Sign in again to access your squads.'
      state.epoch++
    },
    unavailable(state) {
      state.status = 'unavailable'
    },
    retryRestoration(state) {
      state.status = 'restoring'
    },
  },
})
export const sessionActions = slice.actions
export const sessionReducer = slice.reducer
