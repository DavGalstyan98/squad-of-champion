import { useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { AuthPanel } from '../../features/auth/AuthPanel'
import { SessionBootstrap } from '../../features/auth/SessionBootstrap'
import { sessionActions } from '../../features/auth/session'
import { Catalogue } from '../../features/catalogue/Catalogue'
import { SquadPanel } from '../../features/squads/SquadPanel'
import { useSquadManager } from '../../features/squads/useSquadManager'
import { SquadSummary } from '../../entities/squad/SquadSummary'
import { Feedback } from '../../shared/ui/Feedback'
import { errorMessage } from '../../shared/api/errors'
import logo from '../../img/Mortal-Kombat-Logo.png'
function OwnedWorkspace({ ownerId }: { ownerId: string }) {
  const manager = useSquadManager(ownerId)
  const squadTools = useRef<HTMLDetailsElement>(null)
  return (
    <div className="workspace">
      <SquadSummary
        squad={manager.squad}
        disabled={manager.busy || manager.draft !== null}
        pending={manager.mutationPending || manager.detail.isFetching}
        remove={(id) => {
          const character = manager.squad?.members.find(
            (member) => member.character.id === id,
          )?.character
          if (character) void manager.remove(character)
        }}
      />
      {manager.list.isLoading && (
        <p role="status" className="mutation-status">
          Loading squads…
        </p>
      )}
      {manager.list.error && (
        <Feedback message={errorMessage(manager.list.error)} retry={() => manager.list.refetch()} />
      )}
      {manager.detail.error && (
        <Feedback
          message={errorMessage(manager.detail.error)}
          retry={() => manager.detail.refetch()}
        />
      )}
      {manager.error && (
        <p role="alert" className="feedback">
          {manager.error}
        </p>
      )}
      <Catalogue
        memberIds={manager.memberIds}
        canAdd={manager.canAdd}
        add={manager.add}
        members={manager.draft ?? manager.squad?.members.map((member) => member.character) ?? []}
        remove={(character) =>
          manager.draft ? manager.removeDraft(character.id) : void manager.remove(character)
        }
        busy={manager.busy}
        editing={manager.draft !== null}
        selectionRequirement={
          !manager.squad && !manager.busy && !manager.list.isError && !manager.detail.isError
            ? {
                message: 'Create or select a saved squad before choosing characters.',
                action: 'Create or select a squad',
                onAction: () => {
                  const tools = squadTools.current
                  if (tools) {
                    tools.open = true
                    tools.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    tools.querySelector<HTMLElement>('select, input')?.focus()
                  }
                },
              }
            : undefined
        }
      />
      <details className="workspace-tools" ref={squadTools}>
        <summary>
          Manage squads
          {manager.squad && (
            <>
              <span className="squad-name" role="heading" aria-level={3}>
                {manager.squad.name}
              </span>
              <span className="count">{manager.squad.statistics.memberCount} / 6 members</span>
            </>
          )}
        </summary>
        <SquadPanel key={manager.id ?? 'none'} manager={manager} />
      </details>
    </div>
  )
}
export function ChampionsPage() {
  const accountTools = useRef<HTMLDetailsElement>(null)
  const dispatch = useAppDispatch(),
    session = useAppSelector((state) => state.session)
  return (
    <>
      <SessionBootstrap />
      <a className="skip-link" href="#main">
        Skip to catalogue
      </a>
      <header className="site-header">
        <a className="brand" href="#main" aria-label="Squad of Champions">
          <img src={logo} alt="Mortal Kombat" />
        </a>
        <div className="account">
          {session.user && session.status === 'authenticated' ? (
            <>
              <span>{session.user.email}</span>
              <button type="button" onClick={() => dispatch(sessionActions.signedOut())}>
                Log out
              </button>
            </>
          ) : (
            session.token && (
              <button type="button" onClick={() => dispatch(sessionActions.signedOut())}>
                Forget session
              </button>
            )
          )}
        </div>
      </header>
      <main id="main">
        {session.status === 'authenticated' && session.user ? (
          <OwnedWorkspace key={session.user.id} ownerId={session.user.id} />
        ) : (
          <>
            <SquadSummary />
            <Catalogue
              memberIds={[]}
              canAdd={false}
              add={() => {}}
              selectionRequirement={
                session.status === 'anonymous'
                  ? {
                      message:
                        'Sign in or register, then create a saved squad to select characters.',
                      action: 'Sign in to select characters',
                      onAction: () => {
                        const tools = accountTools.current
                        if (tools) {
                          tools.open = true
                          tools.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          tools.querySelector<HTMLElement>('input[type="email"]')?.focus()
                        }
                      },
                    }
                  : undefined
              }
            />
            <details
              className="workspace-tools"
              ref={accountTools}
              open={
                session.status === 'restoring' || session.status === 'unavailable' || session.notice
                  ? true
                  : undefined
              }
            >
              <summary>Sign in or register</summary>
              <AuthPanel />
            </details>
          </>
        )}
      </main>
    </>
  )
}
