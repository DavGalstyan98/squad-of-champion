import type { CharacterRow } from '../catalogue/character.types'

export interface SquadRow {
  id: string
  name: string
  created_at: Date
  updated_at: Date
}

export interface Membership {
  character_id: number
  position: number
}

export interface MemberRow extends CharacterRow {
  squad_id: string
  position: number
}
