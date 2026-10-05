import type { State, SquadKey } from './api.types'
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { sessionActions } from '../../features/auth/session'
import { apiUrl } from './config'
import type { CatalogueQuery, CharacterPage, Filters, Squad, User } from './contracts'

const fetchQuery = fetchBaseQuery({ baseUrl: apiUrl + '/' })
const baseQuery: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError,
  { authenticated?: boolean }
> = async (args, api, options) => {
  const session = (api.getState() as State).session
  const request: FetchArgs = typeof args === 'string' ? { url: args } : args
  const headers = new Headers(request.headers as HeadersInit | undefined)
  if (options?.authenticated && session.token)
    headers.set('Authorization', 'Bearer ' + session.token)
  // RTK 2.2's timeout implementation passes an unbound AbortController.abort
  // listener. Use our own bound listener/deadline to keep native browser aborts safe.
  const controller = new AbortController()
  const abort = () => controller.abort()
  api.signal.addEventListener('abort', abort, { once: true })
  if (api.signal.aborted) abort()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    abort()
  }, 10000)
  let result: Awaited<ReturnType<typeof fetchQuery>>
  try {
    result = await fetchQuery({ ...request, headers }, { ...api, signal: controller.signal }, {})
  } finally {
    clearTimeout(timer)
    api.signal.removeEventListener('abort', abort)
  }
  if (timedOut) return { error: { status: 'TIMEOUT_ERROR', error: 'Request timed out' } }
  const current = (api.getState() as State).session
  // A late response/401 from an old identity must never populate a new identity's cache or log it out.
  if (
    options?.authenticated &&
    (current.epoch !== session.epoch || current.token !== session.token)
  )
    return { error: { status: 'CUSTOM_ERROR', error: 'Session changed. Please retry.' } }
  if (options?.authenticated && result.error?.status === 401 && session.token)
    api.dispatch(sessionActions.expired())
  return result
}

export const api = createApi({
  reducerPath: 'championsApi',
  baseQuery,
  tagTypes: ['Squads'],
  endpoints: (builder) => ({
    me: builder.query<User, void>({
      query: () => 'auth/me',
      extraOptions: { authenticated: true },
      keepUnusedDataFor: 0,
    }),
    characters: builder.query<CharacterPage, CatalogueQuery>({
      query: (query) => {
        const params = new URLSearchParams({
          page: String(query.page),
          limit: String(query.limit),
          search: query.search.trim().toLowerCase(),
          sort: query.sort,
        })
        query.universe.forEach((value) => params.append('universe', value))
        query.tags.forEach((value) => params.append('tags', value))
        return 'characters?' + params.toString()
      },
    }),
    filters: builder.query<Filters, void>({ query: () => 'characters/filters' }),
    squads: builder.query<Squad[], string>({
      query: () => 'squads',
      extraOptions: { authenticated: true },
      providesTags: ['Squads'],
    }),
    squad: builder.query<Squad, SquadKey>({
      query: ({ id }) => 'squads/' + id,
      extraOptions: { authenticated: true },
      providesTags: (_result, _error, { id }) => [{ type: 'Squads', id }],
    }),
    createSquad: builder.mutation<Squad, { ownerId: string; name: string }>({
      query: ({ name }) => ({ url: 'squads', method: 'POST', body: { name } }),
      extraOptions: { authenticated: true },
      invalidatesTags: ['Squads'],
    }),
    patchSquad: builder.mutation<Squad, SquadKey & { name?: string; characterIds?: number[] }>({
      query: ({ id, ownerId, ...body }) => ({ url: 'squads/' + id, method: 'PATCH', body }),
      extraOptions: { authenticated: true },
      invalidatesTags: ['Squads'],
    }),
    deleteSquad: builder.mutation<void, SquadKey>({
      query: ({ id }) => ({ url: 'squads/' + id, method: 'DELETE' }),
      extraOptions: { authenticated: true },
      invalidatesTags: ['Squads'],
    }),
    addMember: builder.mutation<Squad, SquadKey & { characterId: number }>({
      query: ({ id, characterId }) => ({
        url: `squads/${id}/characters/${characterId}`,
        method: 'POST',
      }),
      extraOptions: { authenticated: true },
      invalidatesTags: ['Squads'],
    }),
    removeMember: builder.mutation<Squad, SquadKey & { characterId: number }>({
      query: ({ id, characterId }) => ({
        url: `squads/${id}/characters/${characterId}`,
        method: 'DELETE',
      }),
      extraOptions: { authenticated: true },
      invalidatesTags: ['Squads'],
    }),
  }),
})
export const {
  useMeQuery,
  useCharactersQuery,
  useFiltersQuery,
  useSquadsQuery,
  useSquadQuery,
  useCreateSquadMutation,
  usePatchSquadMutation,
  useDeleteSquadMutation,
  useAddMemberMutation,
  useRemoveMemberMutation,
} = api
