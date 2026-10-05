export interface RawCharacter {
  id: number
  name: string
  quote?: string
  image: string
  thumbnail?: string
  universe: string
  abilities: { abilityName: string; abilityScore: number }[]
  tags?: { slot: number; tag_name: string }[]
}
