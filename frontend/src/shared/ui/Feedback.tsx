export function Feedback({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="feedback" role="alert">
      <p>{message}</p>
      {retry && (
        <button type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  )
}
