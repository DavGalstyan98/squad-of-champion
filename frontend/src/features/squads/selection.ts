import { createSlice, PayloadAction } from '@reduxjs/toolkit'
const slice = createSlice({
  name: 'selection',
  initialState: { squadId: null as string | null },
  reducers: {
    selectSquad(state, action: PayloadAction<string | null>) {
      state.squadId = action.payload
    },
    clearSelection(state) {
      state.squadId = null
    },
  },
})
export const selectionActions = slice.actions
export const selectionReducer = slice.reducer
