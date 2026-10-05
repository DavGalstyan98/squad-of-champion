import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import {
  useSquadsQuery,
  useSquadQuery,
  useCreateSquadMutation,
  usePatchSquadMutation,
  useDeleteSquadMutation,
  useAddMemberMutation,
  useRemoveMemberMutation,
} from '../../shared/api/api'
import type { Character } from '../../shared/api/contracts'
import { selectionActions } from './selection'
import { errorMessage } from '../../shared/api/errors'
export function useSquadManager(ownerId: string) {
  const dispatch = useAppDispatch(),
    id = useAppSelector((state) => state.selection.squadId)
  const list = useSquadsQuery(ownerId, { refetchOnMountOrArgChange: true, refetchOnFocus: true })
  const detail = useSquadQuery(
    { ownerId, id: id || '' },
    { skip: !id, refetchOnMountOrArgChange: true, refetchOnFocus: true },
  )
  const [create, creating] = useCreateSquadMutation(),
    [patch, patching] = usePatchSquadMutation(),
    [removeSquad, deleting] = useDeleteSquadMutation()
  const [addMember, adding] = useAddMemberMutation(),
    [removeMember, removing] = useRemoveMemberMutation()
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  const [replacement, setDraft] = useState<{ squadId: string; characters: Character[] } | null>(
    null,
  )
  // A refetch can automatically select another squad after external deletion.
  // Never expose or submit the previous squad's draft under that new ID.
  const draft = replacement?.squadId === id ? replacement.characters : null
  useEffect(() => {
    setDraft(null)
  }, [id])
  const mutationPending =
    creating.isLoading ||
    patching.isLoading ||
    deleting.isLoading ||
    adding.isLoading ||
    removing.isLoading
  const busy = mutationPending || list.isFetching || detail.isFetching
  const squad = detail.isError ? undefined : detail.currentData
  useEffect(() => {
    if (
      list.currentData &&
      !list.isFetching &&
      !list.isError &&
      (!id || !list.currentData.some((squad) => squad.id === id))
    )
      dispatch(selectionActions.selectSquad(list.currentData[0]?.id ?? null))
  }, [dispatch, id, list.currentData, list.isFetching, list.isError])
  const run = async (operation: () => Promise<unknown>, success: () => void) => {
    setError(null)
    setNotice(null)
    try {
      await operation()
      success()
      return true
    } catch (failure) {
      setError(errorMessage(failure))
      return false
    }
  }
  const selected = draft ?? squad?.members.map((member) => member.character) ?? []
  return {
    list,
    detail,
    squad,
    id,
    error,
    notice,
    draft,
    busy,
    mutationPending,
    memberIds: selected.map((character) => character.id),
    canAdd: Boolean(squad && !busy && selected.length < 6),
    select: (value: string) => {
      setError(null)
      setNotice(null)
      dispatch(selectionActions.selectSquad(value || null))
    },
    create: (name: string) =>
      run(
        async () => {
          const squad = await create({ ownerId, name }).unwrap()
          dispatch(selectionActions.selectSquad(squad.id))
        },
        () => setNotice('Squad created.'),
      ),
    rename: (name: string) =>
      run(
        () => patch({ ownerId, id: id!, name }).unwrap(),
        () => setNotice('Squad renamed.'),
      ),
    delete: () =>
      run(
        () => removeSquad({ ownerId, id: id! }).unwrap(),
        () => {
          dispatch(selectionActions.selectSquad(null))
          setNotice('Squad deleted.')
        },
      ),
    add: (character: Character) => {
      if (
        !squad ||
        busy ||
        selected.some((member) => member.id === character.id) ||
        selected.length >= 6
      )
        return
      if (draft) setDraft({ squadId: id!, characters: [...draft, character] })
      else
        void run(
          () => addMember({ ownerId, id: id!, characterId: character.id }).unwrap(),
          () => setNotice(`${character.name} added.`),
        )
    },
    remove: (character: Character) =>
      run(
        () => removeMember({ ownerId, id: id!, characterId: character.id }).unwrap(),
        () => setNotice(`${character.name} removed.`),
      ),
    startReplacement: () => {
      setError(null)
      setNotice(null)
      if (squad)
        setDraft({ squadId: squad.id, characters: squad.members.map((member) => member.character) })
    },
    discardReplacement: () => {
      setDraft(null)
      setError(null)
    },
    removeDraft: (characterId: number) =>
      setDraft(
        draft
          ? { squadId: id!, characters: draft.filter((character) => character.id !== characterId) }
          : null,
      ),
    saveReplacement: () =>
      run(
        () =>
          patch({
            ownerId,
            id: id!,
            characterIds: (draft ?? []).map((character) => character.id),
          }).unwrap(),
        () => {
          setDraft(null)
          setNotice('Squad members replaced.')
        },
      ),
  }
}
export type SquadManager = ReturnType<typeof useSquadManager>
