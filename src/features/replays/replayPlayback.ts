import type { ShotBounds } from './shotTimeline'

const refreshMargin = 15_000
const loadingTimeout = 20_000

type Intent = { seconds: number; play: boolean }
export type PlaybackState = { ready: boolean; playing: boolean; message: string; error: string }

export function createReplayPlayback(
  video: HTMLVideoElement,
  sign: () => Promise<string>,
  lifetimeMs: number,
  onState: (state: PlaybackState) => void,
) {
  const events = new AbortController()
  let phase: 'signing' | 'loading' | 'ready' | 'failed' = 'failed'
  let generation = 0
  let automaticRecoveryUsed = false
  let expiresAt = 0
  let lastPosition = 0
  let wantPlay = false
  let clipEnd: number | undefined
  let pending: Intent | undefined
  let renewal: ReturnType<typeof setTimeout>
  let timeout: ReturnType<typeof setTimeout>
  let scrub: ReturnType<typeof setTimeout> | undefined
  let frame = 0

  const listen = (event: string, callback: () => void) => video.addEventListener(event, callback, { signal: events.signal })
  const publish = (message = '', error = '') => onState({
    ready: phase === 'ready', playing: phase === 'ready' && !video.paused, message, error,
  })
  const expiring = () => Date.now() >= expiresAt - refreshMargin
  const buffered = (seconds: number) => {
    for (let i = 0; i < video.buffered.length; i++) {
      if (seconds >= video.buffered.start(i) && seconds < video.buffered.end(i)) return true
    }
    return false
  }
  const snapshot = () => pending ?? {
    seconds: phase === 'ready' && !video.error ? video.currentTime : lastPosition,
    play: wantPlay,
  }
  const clear = () => {
    clearTimeout(renewal)
    clearTimeout(timeout)
    clearTimeout(scrub)
    scrub = undefined
    cancelAnimationFrame(frame)
  }

  function fail(message: string) {
    pending = snapshot()
    phase = 'failed'
    generation++
    clear()
    video.pause()
    publish('', message)
  }

  function open(intent: Intent, message: string) {
    pending = intent
    phase = 'signing'
    clear()
    video.pause()
    publish(message)
    const request = ++generation
    const started = Date.now()
    timeout = setTimeout(() => fail('The replay link could not be refreshed. Try again.'), loadingTimeout)
    void sign().then(url => {
      if (request !== generation) return
      clearTimeout(timeout)
      expiresAt = started + lifetimeMs
      phase = 'loading'
      video.src = url
      timeout = setTimeout(() => recover('The replay is taking too long to load.'), loadingTimeout)
    }).catch(() => {
      if (request === generation) fail('This replay could not be opened. Check your connection and access, then try again.')
    })
  }

  function recover(message: string) {
    if (phase === 'signing' || phase === 'failed') return
    if (automaticRecoveryUsed) {
      fail(message)
      return
    }
    automaticRecoveryUsed = true
    open(snapshot(), 'Reconnecting replay…')
  }

  function apply(intent: Intent) {
    lastPosition = intent.seconds
    wantPlay = intent.play
    video.currentTime = Math.max(0, Math.min(intent.seconds, video.duration))
    if (wantPlay) {
      void video.play().catch(() => {
        // A source replacement or explicit pause can interrupt play. The
        // media error event handles actual fetch and decoder failures.
      })
    } else video.pause()
  }

  function drive() {
    if (phase !== 'ready' || !pending || video.seeking) return
    const intent = pending
    if (expiring() && (intent.play || !buffered(intent.seconds))) {
      open(intent, 'Refreshing replay…')
      return
    }
    pending = undefined
    apply(intent)
  }

  function seek(ms: number, end?: number, scrubbing = false) {
    video.pause()
    wantPlay = false
    clipEnd = end === undefined ? undefined : end / 1000
    pending = { seconds: ms / 1000, play: end !== undefined }
    if (scrubbing) {
      scrub ??= setTimeout(() => {
        scrub = undefined
        drive()
      }, 80)
    } else {
      clearTimeout(scrub)
      scrub = undefined
      drive()
    }
  }

  function stop() {
    clearTimeout(scrub)
    scrub = undefined
    wantPlay = false
    clipEnd = undefined
    if (phase === 'ready') pending = undefined
    else if (pending) pending = { ...pending, play: false }
    video.pause()
  }

  function toggle(bounds: ShotBounds) {
    if (!video.paused || pending?.play) {
      wantPlay = false
      if (pending) pending = { ...pending, play: false }
      video.pause()
      return
    }
    const ms = video.currentTime * 1000
    seek(ms >= bounds.start && ms < bounds.end ? ms : bounds.start, bounds.end)
  }

  function finishClip() {
    if (!pending && clipEnd !== undefined && video.currentTime >= clipEnd) {
      const end = clipEnd
      stop()
      video.currentTime = Math.min(video.duration, end)
      return true
    }
    return false
  }

  function checkBoundary() {
    if (phase === 'ready' && !video.paused && !finishClip()) frame = requestAnimationFrame(checkBoundary)
  }

  listen('loadedmetadata', () => {
    if (phase !== 'loading') return
    clearTimeout(timeout)
    phase = 'ready'
    const intent = pending
    pending = undefined
    if (intent) {
      lastPosition = intent.seconds
      wantPlay = intent.play
      if (intent.seconds > 0 || intent.play) apply(intent)
    }
    publish()
    renewal = setTimeout(() => {
      if (phase === 'ready' && wantPlay) open(snapshot(), 'Refreshing replay…')
    }, Math.max(0, expiresAt - refreshMargin - Date.now()))
  })
  listen('play', () => {
    if (phase !== 'ready' || video.paused) return
    wantPlay = true
    if (expiring()) {
      open(snapshot(), 'Refreshing replay…')
      return
    }
    cancelAnimationFrame(frame)
    checkBoundary()
    publish()
  })
  listen('pause', () => {
    cancelAnimationFrame(frame)
    if (phase !== 'ready' || !video.paused || video.error) return
    wantPlay = false
    publish()
  })
  listen('ended', () => {
    if (phase === 'ready') { wantPlay = false; publish() }
  })
  listen('timeupdate', () => {
    if (phase === 'ready' && !video.error && !video.seeking) {
      lastPosition = video.currentTime
      if (!video.paused) finishClip()
    }
  })
  listen('seeking', () => {
    if (phase !== 'ready' || video.error) return
    lastPosition = video.currentTime
    if (expiring() && !buffered(lastPosition)) open(snapshot(), 'Refreshing replay…')
  })
  listen('seeked', () => { if (scrub === undefined) drive() })
  listen('error', () => {
    const code = video.error?.code
    if (!code || code === 1) return
    recover(code === 3 ? 'The browser could not decode this replay. Try reloading it.'
      : code === 4 ? 'The replay could not be loaded or played by this browser.'
      : 'Playback was interrupted. Check your connection and retry.')
  })
  open({ seconds: 0, play: false }, 'Opening replay…')

  return {
    seek,
    stop,
    toggle,
    retry: () => {
      automaticRecoveryUsed = false
      open(snapshot(), 'Reconnecting replay…')
    },
    destroy: () => {
      generation++
      events.abort()
      clear()
      video.pause()
      video.removeAttribute('src')
      video.load()
    },
  }
}
