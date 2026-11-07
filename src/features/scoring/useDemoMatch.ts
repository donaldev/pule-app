import { useEffect, useReducer } from 'react'
import type { PlayerId, Side } from '../../data/fixtures'
export type DemoEvent =
  | { type: 'frame'; side: Side; id: number }
  | { type: 'undo'; target: number; id: number }
export type DemoMatch = {
  players: [PlayerId, PlayerId]
  target: number
  venue: string
  events: DemoEvent[]
  seconds: number
  paused: boolean
  completed: boolean
}
export function activeFrames(events: DemoEvent[]) {
  const undone = new Set(
    events.filter((e) => e.type === 'undo').map((e) => e.target),
  )
  return events.filter(
    (e): e is Extract<DemoEvent, { type: 'frame' }> =>
      e.type === 'frame' && !undone.has(e.id),
  )
}
export function scoreOf(events: DemoEvent[]): [number, number] {
  return activeFrames(events).reduce<[number, number]>(
    (s, e) => {
      s[e.side]++
      return s
    },
    [0, 0],
  )
}
const initial: DemoMatch = {
  players: ['alex', 'jamie'],
  target: 5,
  venue: 'The Green Room',
  events: [0, 1, 0, 1, 0].map((side, id) => ({
    type: 'frame',
    side: side as Side,
    id,
  })),
  seconds: 1124,
  paused: true,
  completed: false,
}
type Action =
  | {
      type: 'start'
      players: [PlayerId, PlayerId]
      target: number
      venue: string
    }
  | { type: 'award'; side: Side }
  | { type: 'undo' }
  | { type: 'pause' }
  | { type: 'tick' }
  | { type: 'complete' }
export function demoReducer(state: DemoMatch, action: Action): DemoMatch {
  const score = scoreOf(state.events)
  switch (action.type) {
    case 'start':
      return {
        players: action.players,
        target: action.target,
        venue: action.venue,
        events: [],
        seconds: 0,
        paused: false,
        completed: false,
      }
    case 'award':
      return state.completed || Math.max(...score) >= state.target
        ? state
        : {
            ...state,
            events: [
              ...state.events,
              { type: 'frame', side: action.side, id: state.events.length },
            ],
          }
    case 'undo': {
      const last = activeFrames(state.events).at(-1)
      return !last || state.completed
        ? state
        : {
            ...state,
            events: [
              ...state.events,
              { type: 'undo', target: last.id, id: state.events.length },
            ],
          }
    }
    case 'pause':
      return { ...state, paused: !state.paused }
    case 'tick':
      return state.paused || state.completed
        ? state
        : { ...state, seconds: state.seconds + 1 }
    case 'complete':
      return Math.max(...score) < state.target
        ? state
        : { ...state, completed: true, paused: true }
  }
}
export function useDemoMatch() {
  const [match, dispatch] = useReducer(demoReducer, initial)
  useEffect(() => {
    if (match.paused || match.completed) return
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => window.clearInterval(timer)
  }, [match.paused, match.completed])
  return { match, dispatch }
}
export type DemoController = ReturnType<typeof useDemoMatch>
export function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
