import { useState } from 'react'
export function CharacterImage({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src)
    return (
      <div className="image-fallback" role="img" aria-label={`${name}: image unavailable`}>
        <span aria-hidden="true">✦</span>
        <small>Image unavailable</small>
      </div>
    )
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  )
}
