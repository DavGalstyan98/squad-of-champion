export interface CatalogueSource {
  checksum: string
  characters: {
    id: number
    name: string
    quote: string | null
    image: string
    thumbnail: string | null
    universe: string
    source_order: number
  }[]
  abilities: {
    character_id: number
    ability_name: string
    ability_score: number
    source_order: number
  }[]
  tags: { character_id: number; slot: number; tag_name: string }[]
}
export interface SeedResult {
  changed: boolean
  revision: string
  checksum: string
}
