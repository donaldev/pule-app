import { useEffect, useRef, useState, type RefObject } from 'react'

export function useImmersiveReplay(playing: boolean, stage: RefObject<HTMLDivElement | null>,
  toggleButton: RefObject<HTMLButtonElement | null>) {
  const [mode, setMode] = useState<'native' | 'viewport' | null>(null)
  const [controls, setControls] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const transition = useRef(false)
  const immersive = mode !== null

  function reveal() {
    clearTimeout(timer.current)
    setControls(true)
    if (immersive && playing) timer.current = setTimeout(() => setControls(false), 2800)
  }

  useEffect(() => {
    if (immersive && playing) {
      timer.current = setTimeout(() => setControls(false), 2800)
    }
    return () => clearTimeout(timer.current)
  }, [immersive, playing])

  useEffect(() => {
    const element = stage.current
    const sync = () => {
      if (document.fullscreenElement === element) setMode('native')
      else setMode(current => current === 'native' ? null : current)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      if (element && document.fullscreenElement === element) void document.exitFullscreen().catch(() => {})
    }
  }, [stage])

  async function toggle() {
    const element = stage.current
    if (!element || transition.current) return
    transition.current = true
    setControls(true)
    try {
      if (immersive) {
        if (document.fullscreenElement === element) await document.exitFullscreen()
        setMode(null)
      } else if (element.requestFullscreen && document.fullscreenEnabled) {
        try {
          await element.requestFullscreen()
          if (element.isConnected) setMode(document.fullscreenElement === element ? 'native' : 'viewport')
        } catch {
          if (element.isConnected) setMode('viewport')
        }
      } else setMode('viewport')
    } finally {
      transition.current = false
      requestAnimationFrame(() => toggleButton.current?.focus({ preventScroll: true }))
    }
  }

  return { immersive, controls: !playing || controls, toggle, reveal,
    tap: () => {
      if (playing && controls) { clearTimeout(timer.current); setControls(false) }
      else reveal()
    },
  }
}
