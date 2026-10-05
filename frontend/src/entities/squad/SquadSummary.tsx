import type { Squad } from '../../shared/api/contracts'
import { CharacterImage } from '../../shared/ui/CharacterImage'
import { abilityOrder } from '../character/CharacterCard'
export function SquadSummary({
  squad,
  disabled = false,
  remove,
  pending = false,
}: {
  squad?: Squad
  disabled?: boolean
  remove?: (id: number) => void
  pending?: boolean
}) {
  const populated = Boolean(squad?.members.length)
  return (
    <section
      className={`squad-summary${populated ? ' populated' : ''}`}
      aria-label="Selected squad"
    >
      <h1>{populated ? 'Your champions!' : 'Select your squad to defend earthrealm'}</h1>
      {populated && (
        <ol className="members" aria-label="Saved squad members">
          {squad!.members.map(({ character }) => (
            <li key={character.id}>
              <div className="member-image">
                <CharacterImage
                  src={character.thumbnail ?? character.image}
                  name={character.name}
                />
              </div>
              <span className="visually-hidden">{character.name}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${character.name} from squad`}
                onClick={() => remove?.(character.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <section className="statistics" aria-label="Server squad statistics" aria-busy={pending}>
        {pending && (
          <span className="visually-hidden" role="status">
            Updating squad averages…
          </span>
        )}
        <dl>
          {abilityOrder.map((name) => {
            const average = squad?.statistics.averages[name] ?? null
            return (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <span className="average-value">
                    <span
                      className={pending ? 'average-text is-loading' : 'average-text'}
                      aria-hidden={pending || undefined}
                    >
                      {average === null ? '—' : Number(average.toFixed(2))}
                    </span>
                    {pending && (
                      <span
                        className="average-skeleton"
                        aria-hidden="true"
                        data-testid="average-skeleton"
                      />
                    )}
                  </span>
                </dd>
              </div>
            )
          })}
        </dl>
        <p className="hint">* Totals are average for squad</p>
      </section>
    </section>
  )
}
