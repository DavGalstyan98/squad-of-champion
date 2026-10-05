import type { CharacterDto } from '../catalogue/catalogue.dto'
import type { SquadStatisticsDto } from './squads.dto'
export const abilityNames = ['Mobility', 'Technique', 'Survivability', 'Power', 'Energy'] as const
export function statistics(characters: CharacterDto[]): SquadStatisticsDto {
  const averages = {
    Mobility: null,
    Technique: null,
    Survivability: null,
    Power: null,
    Energy: null,
  } as SquadStatisticsDto['averages']
  for (const name of abilityNames) {
    if (!characters.length) continue
    const scores = characters.map(
      (character) =>
        character.abilities.find((ability) => ability.abilityName === name)?.abilityScore,
    )
    if (scores.some((score) => score === undefined))
      throw new Error('Incomplete persisted abilities')
    averages[name] = scores.reduce<number>((sum, score) => sum + score!, 0) / characters.length
  }
  return { memberCount: characters.length, averages }
}
