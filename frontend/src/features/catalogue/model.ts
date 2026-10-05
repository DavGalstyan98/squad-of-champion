import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { CatalogueQuery } from '../../shared/api/contracts'
const initialState: CatalogueQuery = {
  page: 1,
  limit: 24,
  search: '',
  universe: [],
  tags: [],
  sort: 'source',
}
const slice = createSlice({
  name: 'catalogue',
  initialState,
  reducers: {
    searchChanged(state, action: PayloadAction<string>) {
      state.search = action.payload
      state.page = 1
    },
    filterToggled(state, action: PayloadAction<{ kind: 'universe' | 'tags'; value: string }>) {
      const { kind, value } = action.payload
      state[kind] = state[kind].includes(value)
        ? state[kind].filter((item) => item !== value)
        : [...state[kind], value].sort()
      state.page = 1
    },
    sortChanged(state, action: PayloadAction<CatalogueQuery['sort']>) {
      state.sort = action.payload
      state.page = 1
    },
    limitChanged(state, action: PayloadAction<number>) {
      state.limit = action.payload
      state.page = 1
    },
    pageChanged(state, action: PayloadAction<number>) {
      state.page = action.payload
    },
    resetFilters() {
      return initialState
    },
  },
})
export const catalogueActions = slice.actions
export const catalogueReducer = slice.reducer
