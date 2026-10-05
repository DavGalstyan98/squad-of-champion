import { useState } from 'react'
import type { SquadManager } from './useSquadManager'
export function SquadPanel({ manager }: { manager: SquadManager }) {
  const [createName, setCreateName] = useState(''),
    [renameName, setRenameName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { squad, busy, draft } = manager
  const disabled = busy || draft !== null
  return (
    <aside className="squad-panel" aria-labelledby="squads-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR TEAM</p>
          <h2 id="squads-title">Saved squads</h2>
        </div>
      </div>
      {manager.notice && (
        <p role="status" className="success">
          {manager.notice}
        </p>
      )}
      {manager.list.currentData && !manager.list.isError && (
        <>
          {manager.list.currentData.length === 0 ? (
            <p>No saved squads yet. Create your first squad.</p>
          ) : (
            <label>
              Active squad
              <select
                value={manager.id ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  manager.select(event.target.value)
                  setRenameName('')
                  setConfirmDelete(false)
                }}
              >
                {manager.list.currentData.map((squad) => (
                  <option key={squad.id} value={squad.id}>
                    {squad.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          void manager.create(createName).then((success) => {
            if (success) setCreateName('')
          })
        }}
      >
        <label>
          New squad name
          <input
            value={createName}
            maxLength={100}
            required
            disabled={disabled}
            onChange={(event) => setCreateName(event.target.value)}
          />
        </label>
        <button disabled={disabled || !createName.trim()} type="submit">
          Create squad
        </button>
      </form>
      {squad && (
        <>
          {squad.members.length >= 6 && !draft && (
            <p className="hint">Squad full. Remove a member or edit the full member list.</p>
          )}
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              void manager.rename(renameName).then((success) => {
                if (success) setRenameName('')
              })
            }}
          >
            <label>
              Rename squad
              <input
                value={renameName}
                required
                maxLength={100}
                disabled={disabled}
                onChange={(event) => setRenameName(event.target.value)}
              />
            </label>
            <button disabled={disabled || !renameName.trim()}>Save name</button>
          </form>
          {draft === null ? (
            <button type="button" disabled={busy} onClick={manager.startReplacement}>
              Edit full member list
            </button>
          ) : (
            <section className="replacement" aria-label="Replacement draft">
              <h4>Replacement draft</h4>
              <p>
                Choose characters from the catalogue, then save the full list. {draft.length} / 6
                staged.
              </p>
              <ul>
                {draft.map((character) => (
                  <li key={character.id}>
                    {character.name}
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${character.name} from replacement draft`}
                      onClick={() => manager.removeDraft(character.id)}
                    >
                      Unstage
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" disabled={busy} onClick={() => void manager.saveReplacement()}>
                Save replacement
              </button>
              <button type="button" disabled={busy} onClick={manager.discardReplacement}>
                Cancel replacement
              </button>
            </section>
          )}
          <div className="delete-controls">
            {confirmDelete ? (
              <>
                <p>Delete “{squad.name}” and its members?</p>
                <button
                  type="button"
                  className="danger"
                  disabled={disabled}
                  onClick={() => {
                    void manager.delete()
                    setConfirmDelete(false)
                  }}
                >
                  Confirm delete squad
                </button>
                <button type="button" disabled={disabled} onClick={() => setConfirmDelete(false)}>
                  Keep squad
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger"
                disabled={disabled}
                onClick={() => setConfirmDelete(true)}
              >
                Delete squad
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
