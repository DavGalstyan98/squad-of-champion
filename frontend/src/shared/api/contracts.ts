export interface User {
  id: string
  email: string
  createdAt: string
}
export type AbilityName = 'Mobility' | 'Technique' | 'Survivability' | 'Power' | 'Energy'
export interface Character {
  id: number
  name: string
  quote: string | null
  image: string
  thumbnail: string | null
  universe: string
  abilities: { abilityName: AbilityName; abilityScore: number }[]
  tags: { slot: number; tag_name: string }[]
}
export interface CharacterPage {
  data: Character[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}
export interface Filters {
  universes: string[]
  tags: string[]
}
export interface CatalogueQuery {
  page: number
  limit: number
  search: string
  universe: string[]
  tags: string[]
  sort: 'source' | 'name_asc' | 'name_desc'
}
export interface Squad {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  members: { position: number; character: Character }[]
  statistics: { memberCount: number; averages: Record<AbilityName, number | null> }
}
export interface LoginResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  user: User
}
