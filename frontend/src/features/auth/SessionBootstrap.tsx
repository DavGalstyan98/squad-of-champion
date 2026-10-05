import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { useMeQuery } from '../../shared/api/api'
import { sessionActions } from './session'
export function SessionBootstrap() {
  const dispatch = useAppDispatch(),
    session = useAppSelector((state) => state.session)
  const me = useMeQuery(undefined, {
    skip: session.status !== 'restoring',
    refetchOnMountOrArgChange: true,
  })
  useEffect(() => {
    if (session.status !== 'restoring') return
    if (me.currentData) dispatch(sessionActions.restored(me.currentData))
    else if (me.isError && !me.isFetching && session.token) dispatch(sessionActions.unavailable())
  }, [dispatch, me.currentData, me.isError, me.isFetching, session.status, session.token])
  useEffect(() => {
    if (!session.token) return
    const payload = JSON.parse(
        atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    )
    if (typeof payload.exp !== 'number') return
    const delay = payload.exp * 1000 - Date.now()
    if (delay <= 0) {
      dispatch(sessionActions.expired())
      return
    }
    const timer = setTimeout(
        () => dispatch(sessionActions.expired()),
        Math.min(delay, 2147483647),
    )
    return () => clearTimeout(timer)
  }, [dispatch, session.token])
  return null
}
