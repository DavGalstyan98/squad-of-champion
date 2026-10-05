export interface CharacterRow {
  id: number
  name: string
  quote: string | null
  image: string
  thumbnail: string | null
  universe: string
}

export interface AbilityRow {
  character_id: number
  ability_name: string
  ability_score: number
}

export interface TagRow {
  character_id: number
  slot: number
  tag_name: string
}
