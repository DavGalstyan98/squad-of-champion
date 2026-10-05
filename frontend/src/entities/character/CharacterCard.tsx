import type { AbilityName, Character } from '../../shared/api/contracts'
import { CharacterImage } from '../../shared/ui/CharacterImage'
export const abilityOrder: AbilityName[] = [
  'Power',
  'Mobility',
  'Technique',
  'Survivability',
  'Energy',
]
export function CharacterCard({
  character,
  selected,
  disabled,
  add,
  remove,
  editing,
  selectionHelpId,
}: {
  character: Character
  selected: boolean
  disabled: boolean
  add: () => void
  remove?: () => void
  editing?: boolean
  selectionHelpId?: string
}) {
  return (
    <article
      className={`character-row${selected ? ' is-selected' : ''}`}
      aria-label={character.name}
    >
      <div className="character-identity">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          aria-describedby={selectionHelpId}
          aria-label={
            selected
              ? `Remove ${character.name} ${editing ? 'from replacement draft' : 'from squad'}`
              : `${editing ? 'Stage' : 'Add'} ${character.name} ${editing ? 'for replacement' : 'to squad'}`
          }
          onChange={() => (selected ? remove?.() : add())}
        />
        <div className="row-avatar">
          <CharacterImage src={character.thumbnail ?? character.image} name={character.name} />
        </div>
        <h3 title={`${character.name} · ${character.universe}`}>{character.name}</h3>
      </div>
      <ul className="tags" aria-label={`${character.name} tags`}>
        {character.tags.map((tag) => (
          <li key={tag.slot}>{tag.tag_name}</li>
        ))}
      </ul>
      {abilityOrder.map((name) => {
        const score = character.abilities.find(
          (ability) => ability.abilityName === name,
        )?.abilityScore
        return (
          <span
            key={name}
            className={`ability-score${score === 10 ? ' maximum-score' : ''}`}
            aria-label={`${name}: ${score ?? 'unavailable'}`}
          >
            {score ?? '—'}
          </span>
        )
      })}
    </article>
  )
}
