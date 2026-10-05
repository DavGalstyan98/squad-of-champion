import { configureStore, createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import { api } from '../shared/api/api'
import {
  initialSession,
  sessionActions,
  sessionReducer,
  storedToken,
  persistToken,
} from '../features/auth/session'
import { selectionActions, selectionReducer } from '../features/squads/selection'
import { catalogueReducer } from '../features/catalogue/model'
export function createAppStore(token: string | null = storedToken()) {
  const listener = createListenerMiddleware()
  listener.startListening({
    matcher: isAnyOf(
      sessionActions.signedIn,
      sessionActions.restored,
      sessionActions.signedOut,
      sessionActions.expired,
      sessionActions.retryRestoration,
    ),
    effect: (_action, listenerApi) => {
      listenerApi.dispatch(selectionActions.clearSelection())
      // Abort requests before resetting state so old in-flight results cannot return after logout.
      for (const request of listenerApi.dispatch(api.util.getRunningQueriesThunk())) request.abort()
      for (const request of listenerApi.dispatch(api.util.getRunningMutationsThunk()))
        request.abort()
      listenerApi.dispatch(api.util.resetApiState())
      persistToken(
        (listenerApi.getState() as { session: ReturnType<typeof initialSession> }).session.token,
      )
    },
  })
  return configureStore({
    reducer: {
      session: sessionReducer,
      selection: selectionReducer,
      catalogue: catalogueReducer,
      [api.reducerPath]: api.reducer,
    },
    preloadedState: { session: initialSession(token) },
    middleware: (getDefault) => getDefault().prepend(listener.middleware).concat(api.middleware),
    // Tokens are credentials; do not expose them to Redux DevTools/action history.
    devTools: false,
  })
}
export const store = createAppStore()
setupListeners(store.dispatch)
export type AppStore = ReturnType<typeof createAppStore>
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
