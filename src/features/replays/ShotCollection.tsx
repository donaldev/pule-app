import { useEffect, useRef, useState } from 'react'
import type { ReplayShot } from '../../data/remote/database.types'
import { Icon } from '../../components/ui/Icon'

export function ShotCollection({ shots, selected, onSelect, sign }: {
  shots: ReplayShot[]
  selected?: string
  onSelect: (shot: ReplayShot) => void
  sign: () => Promise<string>
}) {
  const collection = useRef<HTMLUListElement>(null)
  const thumbnails = useRef(new Map<string, string>())
  const [images, setImages] = useState(new Map<string, string>())

  useEffect(() => {
    const controller = new AbortController()
    let source: Awaited<ReturnType<typeof import('./shotMedia')['openShotThumbnails']>> | undefined
    let openedAt = 0
    let sourceController: AbortController | undefined
    let work = Promise.resolve()
    const observer = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue
        observer.unobserve(target)
        const { thumbnailKey, thumbnailTime } = (target as HTMLElement).dataset
        if (!thumbnailKey || thumbnails.current.has(thumbnailKey)) continue
        work = work.then(async () => {
          if (controller.signal.aborted) return
          if (!source || Date.now() - openedAt >= 270_000) {
            sourceController?.abort()
            sourceController = new AbortController()
            const signal = AbortSignal.any([controller.signal, sourceController.signal])
            const media = await import('./shotMedia')
            openedAt = Date.now()
            source = await media.openShotThumbnails(await sign(), signal)
          }
          const thumbnail = await source.get(Number(thumbnailTime))
          if (thumbnail && !controller.signal.aborted) {
            thumbnails.current.set(thumbnailKey, thumbnail)
            setImages(previous => new Map(previous).set(thumbnailKey, thumbnail))
          }
        }).catch(() => {
          // A clip remains selectable when this browser cannot extract its image.
          sourceController?.abort()
          source = undefined
          controller.abort()
          observer.disconnect()
        })
      }
    })
    collection.current?.querySelectorAll('button').forEach(button => observer.observe(button))
    return () => {
      controller.abort()
      observer.disconnect()
    }
  }, [shots, sign])

  return <ul className="shot-collection" ref={collection}>
    {shots.map((shot, index) => {
      const start = shot.effective_replay_start_ms
      const end = shot.effective_replay_end_ms
      const key = `${shot.candidate_key}:${start}:${end}`
      const thumbnail = images.get(key)
      return <li key={shot.candidate_key}>
        <button type="button" aria-pressed={selected === shot.candidate_key} onClick={() => onSelect(shot)}
          data-thumbnail-key={key} data-thumbnail-time={Math.round((start + end) / 2)}>
          <span className="shot-tile-image">{thumbnail ? <img src={thumbnail} alt="" /> : <Icon name="play" size={24} />}</span>
          <span className="shot-tile-label"><strong>Shot {index + 1}</strong><small>{((end - start) / 1000).toFixed(1)}s</small></span>
        </button>
      </li>
    })}
  </ul>
}
