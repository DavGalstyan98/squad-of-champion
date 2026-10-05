import { FormEvent, useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { authenticate } from './auth-request'
import { sessionActions } from './session'
import { errorMessage } from '../../shared/api/errors'
import { Feedback } from '../../shared/ui/Feedback'
export function AuthPanel() {
  const dispatch = useAppDispatch(),
    session = useAppSelector((state) => state.session)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('')
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 10000)
    setPending(true)
    setError(null)
    try {
      const result = await authenticate(mode, email, password, controller.signal)
      if (!controller.signal.aborted)
        dispatch(sessionActions.signedIn({ token: result.accessToken, user: result.user }))
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure))
      else setError('Sign-in took too long. Please try again.')
    } finally {
      clearTimeout(timeout)
      setPassword('')
      setPending(false)
    }
  }
  if (session.status === 'restoring') return <p role="status">Restoring your session…</p>
  if (session.status === 'unavailable')
    return (
      <Feedback
        message="Unable to restore your session. Your squads are hidden until we verify your account."
        retry={() => dispatch(sessionActions.retryRestoration())}
      />
    )
  return (
    <section className="auth-panel" aria-label="Account">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h2>{mode === 'login' ? 'Sign in to build your squad' : 'Create an account'}</h2>
        </div>
        <div className="auth-tabs">
          <button
            type="button"
            aria-pressed={mode === 'login'}
            disabled={pending}
            onClick={() => {
              setMode('login')
              setError(null)
              setPassword('')
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            aria-pressed={mode === 'register'}
            disabled={pending}
            onClick={() => {
              setMode('register')
              setError(null)
              setPassword('')
            }}
          >
            Register
          </button>
        </div>
      </div>
      {session.notice && <p role="alert">{session.notice}</p>}
      {error && <Feedback message={error} />}
      <form onSubmit={submit} className="auth-form">
        <label>
          Email
          <input
            type="email"
            value={email}
            required
            maxLength={254}
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            required
            minLength={8}
            maxLength={128}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button disabled={pending} className="primary">
          {pending ? 'Please wait…' : mode === 'login' ? 'Sign in to account' : 'Create account'}
        </button>
      </form>
      <p className="hint">
        Browse without an account. Sign in to save squads across visits and devices.
      </p>
    </section>
  )
}
