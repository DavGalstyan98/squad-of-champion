import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import App from './App'
import { createAppStore, AppStore } from './app/store'
import { api } from './shared/api/api'
import { sessionActions, TOKEN_KEY } from './features/auth/session'
import type { Character, Squad, User } from './shared/api/contracts'
import { CharacterImage } from './shared/ui/CharacterImage'

const alice: User = {
  id: 'alice-id',
  email: 'alice@example.com',
  createdAt: '2026-10-05T00:00:00.000Z',
}
const bob: User = { id: 'bob-id', email: 'bob@example.com', createdAt: '2026-10-05T00:00:00.000Z' }
const names = ['Mobility', 'Technique', 'Survivability', 'Power', 'Energy'] as const
const character = (id: number, name: string): Character => ({
  id,
  name,
  quote: null,
  image: 'https://images.example/' + id + '.png',
  thumbnail: null,
  universe: 'Universe A',
  tags: [{ slot: 3, tag_name: 'human' }],
  abilities: names.map((abilityName) => ({ abilityName, abilityScore: 9 })),
})
const alpha = character(1, 'Alpha'),
  beta = character(2, 'Beta'),
  gamma = character(3, 'Gamma')
const squad = (id: string, name: string, characters: Character[] = []): Squad => ({
  id,
  name,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  members: characters.map((character, index) => ({ position: index + 1, character })),
  statistics: {
    memberCount: characters.length,
    averages: {
      Mobility: characters.length ? 4.25 : null,
      Technique: null,
      Survivability: null,
      Power: null,
      Energy: null,
    },
  },
})
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const failure = (status: number, message: string) =>
  json({ statusCode: status, error: 'TEST_ERROR', message }, status)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let stores: AppStore[] = []
let requests: { path: string; method: string; search: string }[] = []
let handler: (request: Request, url: URL) => Promise<Response | undefined>
let saved: Squad[]
const page = (data: Character[], page = 1, total = data.length) => ({
  data,
  meta: { page, limit: 24, total, totalPages: Math.ceil(total / 24) },
})
function mount(token: string | null = null) {
  const store = createAppStore(token)
  stores.push(store)
  const view = render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  if (!token) fireEvent.click(screen.getByText('Sign in or register', { exact: true }))
  return { store, ...view }
}
async function signedIn() {
  const view = mount()
  act(() => {
    view.store.dispatch(sessionActions.signedIn({ token: 'alice-token', user: alice }))
  })
  await screen.findByText('alice@example.com')
  fireEvent.click(screen.getByText('Manage squads', { exact: false }))
  return view
}
beforeEach(() => {
  sessionStorage.clear()
  requests = []
  saved = []
  handler = async () => undefined
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init),
      url = new URL(request.url)
    const path = url.pathname.replace('/api/v1/', '')
    requests.push({ path, method: request.method, search: url.search })
    const custom = await handler(request, url)
    if (custom) return custom
    if (path === 'auth/me') return json(alice)
    if (path === 'auth/register') return json(alice, 201)
    if (path === 'auth/login')
      return json({ accessToken: 'alice-token', tokenType: 'Bearer', expiresIn: 3600, user: alice })
    if (path === 'characters/filters')
      return json({ universes: ['Universe A', 'Universe B'], tags: ['human', 'magic'] })
    if (path === 'characters')
      return json(
        page(
          Number(url.searchParams.get('page')) === 2 ? [gamma] : [alpha, beta],
          Number(url.searchParams.get('page')),
          25,
        ),
      )
    if (path === 'squads' && request.method === 'GET') return json(saved)
    if (path === 'squads' && request.method === 'POST') {
      const body = await request.json()
      const result = squad('new-squad', body.name)
      saved = [result, ...saved]
      return json(result, 201)
    }
    const parts = path.split('/'),
      id = parts[1],
      existing = saved.find((item) => item.id === id)
    if (parts[0] === 'squads' && existing) {
      if (parts.length === 2 && request.method === 'GET') return json(existing)
      if (parts.length === 2 && request.method === 'DELETE') {
        saved = saved.filter((item) => item.id !== id)
        return new Response(null, { status: 204 })
      }
      let members = existing.members.map((member) => member.character),
        name = existing.name
      if (request.method === 'PATCH') {
        const body = await request.json()
        name = body.name ?? name
        if (body.characterIds)
          members = body.characterIds.map(
            (id: number) => [alpha, beta, gamma].find((item) => item.id === id)!,
          )
      }
      if (parts[2] === 'characters' && request.method === 'POST')
        members.push([alpha, beta, gamma].find((item) => item.id === Number(parts[3]))!)
      if (parts[2] === 'characters' && request.method === 'DELETE')
        members = members.filter((item) => item.id !== Number(parts[3]))
      const result = squad(id, name, members)
      saved = saved.map((item) => (item.id === id ? result : item))
      return json(result)
    }
    return failure(404, 'Not found')
  })
})
test('blocked selection explains sign-in and squad prerequisites and focuses the required form', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  })
  const view = mount()
  const checkbox = await screen.findByRole('checkbox', { name: 'Add Alpha to squad' })
  expect(checkbox).toBeDisabled()
  fireEvent.click(checkbox)
  expect(checkbox).not.toBeChecked()
  expect(screen.queryByText('Catalogue options')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Per page')).not.toBeInTheDocument()
  expect(checkbox).toHaveAccessibleDescription(
    /Sign in or register, then create a saved squad to select characters/,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to select characters' }))
  expect(screen.getByLabelText('Email', { exact: true })).toHaveFocus()
  expect(requests.some((request) => request.path.startsWith('squads'))).toBe(false)
  act(() => {
    view.store.dispatch(sessionActions.signedIn({ token: 'alice-token', user: alice }))
  })
  const createAction = await screen.findByRole('button', { name: 'Create or select a squad' })
  expect(screen.getByRole('checkbox', { name: 'Add Alpha to squad' })).toBeDisabled()
  fireEvent.click(createAction)
  expect(screen.getByLabelText('New squad name')).toHaveFocus()
  fireEvent.change(screen.getByLabelText('New squad name'), { target: { value: 'First squad' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create squad', exact: true }))
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Add Alpha to squad' })).toBeEnabled(),
  )
  expect(screen.queryByRole('button', { name: 'Create or select a squad' })).not.toBeInTheDocument()
})
afterEach(() => {
  cleanup()
  for (const store of stores) {
    for (const request of store.dispatch(api.util.getRunningQueriesThunk())) request.abort()
    store.dispatch(api.util.resetApiState())
  }
  stores = []
  jest.restoreAllMocks()
  jest.useRealTimers()
})

test('restores with /me before private queries, stores only token, and logout clears private cache and selection', async () => {
  saved = [squad('private-a', 'Alice private squad', [alpha])]
  const me = deferred<Response>()
  handler = async (_request, url) => (url.pathname.endsWith('/auth/me') ? me.promise : undefined)
  sessionStorage.setItem(TOKEN_KEY, 'alice-token')
  const view = mount('alice-token')
  expect(screen.getByText('Restoring your session…')).toBeInTheDocument()
  expect(requests.some((request) => request.path === 'squads')).toBe(false)
  await act(async () => {
    me.resolve(json(alice))
  })
  await screen.findByRole('heading', { name: 'Alice private squad' })
  expect(view.store.getState().selection.squadId).toBe('private-a')
  expect(sessionStorage.length).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
  expect(screen.queryByRole('heading', { name: 'Alice private squad' })).not.toBeInTheDocument()
  expect(view.store.getState().selection.squadId).toBeNull()
  expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
  expect(JSON.stringify(view.store.getState().championsApi)).not.toContain('Alice private squad')
})

test('identity change clears another user data and a late old response cannot repopulate or expire the new session', async () => {
  saved = [squad('private-a', 'Alice private squad', [alpha])]
  const view = await signedIn()
  await screen.findByRole('heading', { name: 'Alice private squad' })
  const late = deferred<Response>()
  handler = async (request, url) => {
    if (
      url.pathname.endsWith('/squads') &&
      request.headers.get('Authorization') === 'Bearer alice-token'
    )
      return late.promise
    if (
      url.pathname.endsWith('/squads') &&
      request.headers.get('Authorization') === 'Bearer bob-token'
    )
      return json([])
    return undefined
  }
  act(() => {
    view.store.dispatch(api.endpoints.squads.initiate(alice.id, { forceRefetch: true }))
  })
  await waitFor(() =>
    expect(requests.filter((request) => request.path === 'squads').length).toBeGreaterThan(1),
  )
  act(() => {
    view.store.dispatch(sessionActions.signedIn({ token: 'bob-token', user: bob }))
  })
  await screen.findByText('bob@example.com')
  await act(async () => {
    late.resolve(failure(401, 'Expired old token'))
  })
  await screen.findByText('No saved squads yet. Create your first squad.')
  expect(view.store.getState().session.user?.id).toBe(bob.id)
  expect(view.store.getState().selection.squadId).toBeNull()
  expect(JSON.stringify(view.store.getState().championsApi)).not.toContain('Alice private squad')
})

test('register/login keep passwords out of Redux/storage and private 401 shows expiry with public catalogue usable', async () => {
  const view = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Register', exact: true }))
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: alice.email } })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'never-store-this-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  await screen.findByText(alice.email)
  expect(requests.some((request) => request.path === 'auth/register')).toBe(true)
  expect(requests.some((request) => request.path === 'auth/login')).toBe(true)
  expect(JSON.stringify(view.store.getState())).not.toContain('never-store-this-password')
  expect(sessionStorage.length).toBe(1)
  await screen.findByText('No saved squads yet. Create your first squad.')
  handler = async (_request, url) =>
    url.pathname.endsWith('/squads') ? failure(401, 'Authentication required') : undefined
  act(() => {
    view.store.dispatch(api.endpoints.squads.initiate(alice.id, { forceRefetch: true }))
  })
  await screen.findByText('Your session expired. Sign in again to access your squads.')
  expect(view.store.getState().session.token).toBeNull()
  expect(sessionStorage.length).toBe(0)
  await screen.findByRole('article', { name: 'Alpha' })
})

test('restoration network failure hides squads and retries successfully', async () => {
  let fail = true
  handler = async (_request, url) =>
    url.pathname.endsWith('/auth/me') && fail ? failure(503, 'Unavailable') : undefined
  mount('alice-token')
  await screen.findByText(
    'Unable to restore your session. Your squads are hidden until we verify your account.',
  )
  expect(requests.some((request) => request.path === 'squads')).toBe(false)
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText(alice.email)
})

test('debounces search, resets pagination for tag filters, and ignores late old search responses', async () => {
  mount()
  await screen.findByRole('article', { name: 'Alpha' })
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('article', { name: 'Gamma' })
  const old = deferred<Response>()
  handler = async (_request, url) => {
    if (url.pathname.endsWith('/characters') && url.searchParams.get('search') === 'old')
      return old.promise
    if (url.pathname.endsWith('/characters') && url.searchParams.get('search') === 'new')
      return json(page([beta]))
    return undefined
  }
  const search = screen.getByLabelText('Search by name')
  fireEvent.change(search, { target: { value: 'o' } })
  fireEvent.change(search, { target: { value: 'old' } })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180))
  })
  expect(requests.some((request) => request.search.includes('search=old'))).toBe(false)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180))
  })
  await waitFor(() =>
    expect(
      requests.some(
        (request) => request.search.includes('search=old') && request.search.includes('page=1'),
      ),
    ).toBe(true),
  )
  fireEvent.change(search, { target: { value: 'new' } })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })
  await screen.findByRole('article', { name: 'Beta' })
  await act(async () => {
    old.resolve(json(page([alpha])))
  })
  expect(screen.queryByRole('article', { name: 'Alpha' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('magic'))
  await waitFor(() =>
    expect(
      requests.some(
        (request) => request.search.includes('tags=magic') && request.search.includes('page=1'),
      ),
    ).toBe(true),
  )
})

test('saved selection stays visible across catalogue pages and filters; checked rows toggle removal', async () => {
  saved = [squad('persist', 'Persistent squad', [alpha])]
  await signedIn()
  await screen.findByRole('heading', { name: 'Persistent squad' })
  const members = screen.getByRole('list', { name: 'Saved squad members' })
  expect(within(members).getByText('Alpha')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('article', { name: 'Gamma' })
  expect(within(members).getByText('Alpha')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('magic'))
  await screen.findByRole('article', { name: 'Alpha' })
  expect(
    within(screen.getByRole('list', { name: 'Saved squad members' })).getByText('Alpha'),
  ).toBeInTheDocument()
})

test('squad create/add/remove/rename/replacement/delete render authoritative server statistics', async () => {
  await signedIn()
  await screen.findByText('No saved squads yet. Create your first squad.')
  fireEvent.change(screen.getByLabelText('New squad name'), { target: { value: 'My squad' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create squad', exact: true }))
  await screen.findByRole('heading', { name: 'My squad' })
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Add Alpha to squad' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add Alpha to squad' }))
  await screen.findByText('1 / 6 members')
  expect(
    within(screen.getByRole('region', { name: 'Server squad statistics' })).getByText('4.25'),
  ).toBeInTheDocument()
  // Scores in characters are 9: rendering 4.25 proves this is server data, not a client average.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Remove Alpha from squad' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from squad' }))
  await screen.findByText('0 / 6 members')
  expect(
    within(screen.getByRole('region', { name: 'Server squad statistics' })).getAllByText('—'),
  ).toHaveLength(5)
  await waitFor(() => expect(screen.getByLabelText('Rename squad')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Rename squad'), { target: { value: 'Renamed squad' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
  await screen.findByRole('heading', { name: 'Renamed squad' })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit full member list' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit full member list' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Stage Beta for replacement' }))
  expect(screen.getByText('0 / 6 members')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save replacement' }))
  await screen.findByText('1 / 6 members')
  expect(
    within(screen.getByRole('list', { name: 'Saved squad members' })).getByText('Beta'),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete squad', exact: true })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete squad', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete squad' }))
  await screen.findByText('No saved squads yet. Create your first squad.')
  expect(screen.queryByRole('heading', { name: 'Renamed squad' })).not.toBeInTheDocument()
})

test('failed and full-squad mutations do not create false local state; pending controls disable and recovery works', async () => {
  saved = [squad('failed', 'Failed squad', [alpha])]
  await signedIn()
  await screen.findByRole('heading', { name: 'Failed squad' })
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Add Beta to squad' })).toBeEnabled(),
  )
  const blocked = deferred<Response>()
  handler = async (request, url) =>
    request.method === 'POST' && url.pathname.endsWith('/characters/2')
      ? blocked.promise
      : undefined
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add Beta to squad' }))
  await screen.findByText('Updating squad averages…')
  expect(screen.getAllByTestId('average-skeleton')).toHaveLength(5)
  expect(screen.getByRole('checkbox', { name: 'Add Beta to squad' })).toBeDisabled()
  expect(screen.getByText('1 / 6 members')).toBeInTheDocument()
  await act(async () => {
    blocked.resolve(failure(409, 'A squad cannot have more than 6 characters'))
  })
  await screen.findByText('A squad cannot have more than 6 characters')
  await waitFor(() => expect(screen.queryAllByTestId('average-skeleton')).toHaveLength(0))
  const savedMembers = screen.getByRole('list', { name: 'Saved squad members' })
  expect(within(savedMembers).queryByText('Beta')).not.toBeInTheDocument()
  handler = async () => undefined
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Add Beta to squad' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add Beta to squad' }))
  await screen.findByText('2 / 6 members')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit full member list' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit full member list' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from replacement draft' }))
  handler = async (request, url) =>
    request.method === 'PATCH' && url.pathname.includes('/squads/')
      ? failure(503, 'Squad busy; retry')
      : undefined
  fireEvent.click(screen.getByRole('button', { name: 'Save replacement' }))
  await screen.findByText('Squad busy; retry')
  expect(screen.getByText('2 / 6 members')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Replacement draft' })).toBeInTheDocument()
})

test('six-member squads disable additions and explain the limit', async () => {
  saved = [
    squad('full', 'Full squad', [
      alpha,
      ...[4, 5, 6, 7, 8].map((id) => character(id, 'Member ' + id)),
    ]),
  ]
  await signedIn()
  await screen.findByText('6 / 6 members')
  expect(screen.getByRole('checkbox', { name: 'Add Beta to squad' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add Beta to squad' }))
  expect(screen.getByRole('checkbox', { name: 'Add Beta to squad' })).not.toBeChecked()
  expect(
    screen.getByText('Squad full. Remove a member or edit the full member list.'),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' }))
  await screen.findByText('5 / 6 members')
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Add Beta to squad' })).toBeEnabled(),
  )
})

test('catalogue loading/empty/error/retry and missing-image states are readable and recover', async () => {
  const response = deferred<Response>()
  handler = async (_request, url) =>
    url.pathname.endsWith('/characters') ? response.promise : undefined
  mount()
  expect(screen.getByText('Loading characters…')).toBeInTheDocument()
  await act(async () => {
    response.resolve(failure(503, 'Catalogue unavailable'))
  })
  await screen.findByText('Catalogue unavailable')
  handler = async (_request, url) =>
    url.pathname.endsWith('/characters') ? json(page([])) : undefined
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('The catalogue is empty')
  handler = async () => undefined
  fireEvent.click(screen.getByRole('button', { name: 'Show all characters' }))
  // A tag change requests fresh server data rather than reusing the cached empty query.
  fireEvent.click(screen.getByLabelText('magic'))
  await screen.findByRole('article', { name: 'Alpha' })
  const image = within(screen.getByRole('article', { name: 'Alpha' })).getByRole('img', {
    name: 'Alpha',
  })
  fireEvent.error(image)
  expect(screen.getByRole('img', { name: 'Alpha: image unavailable' })).toBeInTheDocument()
})

test('null and broken image fallback resets when the source changes', () => {
  const view = render(<CharacterImage src={null} name="Test champion" />)
  expect(screen.getByRole('img', { name: 'Test champion: image unavailable' })).toBeInTheDocument()
  view.rerender(<CharacterImage src="https://images.example/new.png" name="Test champion" />)
  fireEvent.error(screen.getByRole('img', { name: 'Test champion' }))
  expect(screen.getByRole('img', { name: 'Test champion: image unavailable' })).toBeInTheDocument()
  view.rerender(<CharacterImage src="https://images.example/other.png" name="Test champion" />)
  expect(screen.getByRole('img', { name: 'Test champion' })).toBeInTheDocument()
})

test('external deletion of the active squad discards its replacement draft before selecting another squad', async () => {
  saved = [squad('first', 'First squad', [alpha]), squad('second', 'Second squad', [gamma])]
  const view = await signedIn()
  await screen.findByRole('heading', { name: 'First squad' })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit full member list' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit full member list' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from replacement draft' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Stage Beta for replacement' }))
  expect(
    within(screen.getByRole('region', { name: 'Replacement draft' })).getByText('Beta'),
  ).toBeInTheDocument()
  saved = saved.filter((item) => item.id !== 'first')
  act(() => {
    view.store.dispatch(api.util.invalidateTags(['Squads']))
  })
  await screen.findByRole('heading', { name: 'Second squad' })
  expect(screen.queryByRole('region', { name: 'Replacement draft' })).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('list', { name: 'Saved squad members' })).getByText('Gamma'),
  ).toBeInTheDocument()
  expect(
    requests.some((request) => request.method === 'PATCH' && request.path === 'squads/second'),
  ).toBe(false)
})

test('My Team includes saved members from every page and checked rows remove pessimistically', async () => {
  saved = [squad('team-view', 'Team view', [alpha, gamma])]
  await signedIn()
  await screen.findByRole('heading', { name: 'Team view' })
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('article', { name: 'Gamma' })
  fireEvent.click(screen.getByRole('button', { name: 'My Team' }))
  expect(screen.getByRole('button', { name: 'My Team' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('article', { name: 'Alpha' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Gamma' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  const pending = deferred<Response>()
  handler = async (request, url) =>
    request.method === 'DELETE' && url.pathname.endsWith('/characters/1')
      ? pending.promise
      : undefined
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' })).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' }))
  await screen.findByText('Updating squad averages…')
  expect(screen.getAllByTestId('average-skeleton')).toHaveLength(5)
  expect(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' })).toBeChecked()
  await act(async () => pending.resolve(failure(503, 'Removal failed; retry')))
  await screen.findByText('Removal failed; retry')
  await waitFor(() => expect(screen.queryAllByTestId('average-skeleton')).toHaveLength(0))
  expect(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' })).toBeChecked()
  handler = async () => undefined
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remove Alpha from squad' }))
  await waitFor(() =>
    expect(screen.queryByRole('article', { name: 'Alpha' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('article', { name: 'Gamma' })).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('magic'))
  await screen.findByText('No matching characters')
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
  await screen.findByRole('article', { name: 'Alpha' })
  expect(screen.getByRole('button', { name: 'My Team' })).toHaveAttribute('aria-pressed', 'false')
})
