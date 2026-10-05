import { useEffect, useId, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { useCharactersQuery, useFiltersQuery } from '../../shared/api/api'
import type { Character } from '../../shared/api/contracts'
import { catalogueActions } from './model'
import { CharacterCard } from '../../entities/character/CharacterCard'
import { errorMessage } from '../../shared/api/errors'
import { Feedback } from '../../shared/ui/Feedback'
// Presentation order from the supplied reference; filter values still come from metadata.
const referenceTagOrder = [
  'monster',
  'melee',
  'human',
  'ninja',
  'agile',
  'god',
  'aerial',
  'strong',
  'grappling',
  'defend',
  'attack',
  'block',
  'mercenary',
  'demon',
  'robot',
  'magic',
  'ranged',
  'alien',
  'ghost',
  'grapple',
  'animal',
]
export function Catalogue({
  memberIds,
  canAdd,
  add,
  editing,
  members = [],
  remove,
  busy = false,
  selectionRequirement,
}: {
  memberIds: number[]
  canAdd: boolean
  add: (character: Character) => void
  editing?: boolean
  members?: Character[]
  remove?: (character: Character) => void
  busy?: boolean
  selectionRequirement?: { message: string; action: string; onAction: () => void }
}) {
  const selectionHelpId = useId()
  const dispatch = useAppDispatch(),
    query = useAppSelector((state) => state.catalogue)
  const [draft, setDraft] = useState(query.search)
  const [teamOnly, setTeamOnly] = useState(false)
  const filters = useFiltersQuery()
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft !== query.search) dispatch(catalogueActions.searchChanged(draft))
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, query.search, dispatch])
  const result = useCharactersQuery(query)
  // currentData belongs only to the current arguments; older requests cannot overwrite this view.
  const savedPage = result.currentData
  const team = members
    .filter(
      (character) =>
        character.name.toLowerCase().includes(query.search.trim().toLowerCase()) &&
        (!query.universe.length || query.universe.includes(character.universe)) &&
        query.tags.every((tag) => character.tags.some((item) => item.tag_name === tag)),
    )
    .sort((a, b) =>
      query.sort === 'source'
        ? 0
        : (query.sort === 'name_desc' ? -1 : 1) * (a.name.localeCompare(b.name) || a.id - b.id),
    )
  const page = teamOnly
    ? { data: team, meta: { page: 1, limit: 6, total: team.length, totalPages: 1 } }
    : savedPage
  const reset = () => {
    setDraft('')
    setTeamOnly(false)
    dispatch(catalogueActions.resetFilters())
  }
  return (
    <section className="catalogue" aria-labelledby="catalogue-title">
      <h2 id="catalogue-title" className="visually-hidden">
        Choose your champions
      </h2>
      {selectionRequirement ? (
        <div className="selection-guidance" id={selectionHelpId}>
          <p>{selectionRequirement.message}</p>
          <button type="button" onClick={selectionRequirement.onAction}>
            {selectionRequirement.action}
          </button>
        </div>
      ) : memberIds.length >= 6 ? (
        <p className="selection-guidance" id={selectionHelpId} role="status">
          Squad full (6 / 6). Deselect a character or remove an avatar before adding another.
        </p>
      ) : null}
      <div className="filters">
        <label className="search">
          <span className="visually-hidden">Search by name</span>
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            aria-label="Search by name"
            type="search"
            maxLength={200}
            value={draft}
            placeholder="Search Characters…"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {filters.isLoading && <p role="status">Loading filters…</p>}
        {filters.error && (
          <Feedback message={errorMessage(filters.error)} retry={() => filters.refetch()} />
        )}
        {filters.currentData && (
          <>
            <fieldset className="tag-filters">
              <legend className="visually-hidden">Tags (match all)</legend>
              <div className="filter-options">
                {filters.currentData.tags
                  .slice()
                  .sort((a, b) => {
                    const rank = (tag: string) =>
                      referenceTagOrder.indexOf(tag) < 0
                        ? referenceTagOrder.length
                        : referenceTagOrder.indexOf(tag)
                    return rank(a) - rank(b) || a.localeCompare(b)
                  })
                  .map((value) => (
                    <label
                      key={value}
                      className={`tag-pill${query.tags.includes(value) ? ' active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={value}
                        checked={query.tags.includes(value)}
                        onChange={() =>
                          dispatch(catalogueActions.filterToggled({ kind: 'tags', value }))
                        }
                      />
                      {query.tags.includes(value) && <span aria-hidden="true">✓ </span>}
                      {value}
                    </label>
                  ))}
                <button
                  type="button"
                  className={`tag-pill${teamOnly ? ' active' : ''}`}
                  aria-pressed={teamOnly}
                  onClick={() => setTeamOnly(!teamOnly)}
                >
                  My Team
                </button>
                <button
                  type="button"
                  className="clear-filters"
                  aria-label="Reset filters"
                  onClick={reset}
                >
                  Clear all
                </button>
              </div>
            </fieldset>
          </>
        )}
      </div>
      {draft !== query.search && (
        <p className="hint" role="status">
          Waiting for search…
        </p>
      )}
      {result.isFetching && (
        <p role="status">{page ? 'Updating characters…' : 'Loading characters…'}</p>
      )}
      {result.error ? (
        <Feedback message={errorMessage(result.error)} retry={() => result.refetch()} />
      ) : (
        page && (
          <>
            {page.data.length === 0 ? (
              <div className="empty">
                <h3>
                  {query.search || query.tags.length || query.universe.length
                    ? 'No matching characters'
                    : 'The catalogue is empty'}
                </h3>
                <p>
                  {page.meta.total
                    ? 'This page has no characters. Go back to the first page.'
                    : 'Try another search or reset your filters.'}
                </p>
                <button type="button" onClick={reset}>
                  Show all characters
                </button>
              </div>
            ) : (
              <div className="character-list">
                <div className="table-heading" aria-hidden="true">
                  <span>Character</span>
                  <span>Tags</span>
                  {['Power', 'Mobility', 'Technique', 'Survivability', 'Energy'].map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </div>
                <div className="character-grid" aria-busy={result.isFetching}>
                  {page.data.map((character) => (
                    <CharacterCard
                      key={character.id}
                      character={character}
                      selected={memberIds.includes(character.id)}
                      disabled={
                        (memberIds.includes(character.id) ? !remove || busy : !canAdd) ||
                        result.isFetching ||
                        draft !== query.search
                      }
                      editing={editing}
                      selectionHelpId={
                        selectionRequirement || memberIds.length >= 6 ? selectionHelpId : undefined
                      }
                      add={() => add(character)}
                      remove={() => remove?.(character)}
                    />
                  ))}
                </div>
              </div>
            )}
            <nav className="pagination" aria-label="Character pages">
              <button
                type="button"
                disabled={
                  teamOnly || query.page <= 1 || result.isFetching || draft !== query.search
                }
                onClick={() => dispatch(catalogueActions.pageChanged(query.page - 1))}
              >
                Previous page
              </button>
              <span aria-live="polite">
                Page {page.meta.page} of {Math.max(1, page.meta.totalPages)}
              </span>
              <button
                type="button"
                disabled={
                  teamOnly ||
                  query.page >= page.meta.totalPages ||
                  result.isFetching ||
                  draft !== query.search
                }
                onClick={() => dispatch(catalogueActions.pageChanged(query.page + 1))}
              >
                Next page
              </button>
            </nav>
          </>
        )
      )}
    </section>
  )
}
