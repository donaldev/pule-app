// Entirely fictional fixtures. No imported records or predecessor rules.
export const players = [
  {
    id: 'alex',
    name: 'Alex Morgan',
    initials: 'AM',
    color: 'sage',
    note: 'Your demo player',
  },
  {
    id: 'jamie',
    name: 'Jamie Park',
    initials: 'JP',
    color: 'clay',
    note: 'A familiar rival',
  },
  {
    id: 'riley',
    name: 'Riley Chen',
    initials: 'RC',
    color: 'blue',
    note: 'The patient competitor',
  },
  {
    id: 'sam',
    name: 'Sam Ellis',
    initials: 'SE',
    color: 'brass',
    note: 'Always up for another',
  },
] as const
export type PlayerId = (typeof players)[number]['id']
export function player(id: PlayerId) {
  return players.find((p) => p.id === id)!
}
export type Side = 0 | 1
export type Match = {
  id: string
  date: string
  opponent: PlayerId
  score: [number, number]
  venue: string
  frames?: Side[]
}
export const matches: Match[] = [
  {
    id: 'm12',
    date: '2026-11-02',
    opponent: 'jamie',
    score: [5, 3],
    venue: 'The Green Room',
    frames: [1, 1, 1, 0, 0, 0, 0, 0],
  },
  {
    id: 'm11',
    date: '2026-10-29',
    opponent: 'riley',
    score: [5, 2],
    venue: 'Northline Billiards',
  },
  {
    id: 'm10',
    date: '2026-10-26',
    opponent: 'jamie',
    score: [2, 5],
    venue: 'The Green Room',
  },
  {
    id: 'm9',
    date: '2026-10-24',
    opponent: 'sam',
    score: [5, 4],
    venue: 'Northline Billiards',
  },
  {
    id: 'm8',
    date: '2026-10-20',
    opponent: 'jamie',
    score: [5, 4],
    venue: 'The Green Room',
  },
  {
    id: 'm7',
    date: '2026-10-17',
    opponent: 'riley',
    score: [3, 5],
    venue: 'The Green Room',
  },
  {
    id: 'm6',
    date: '2026-10-14',
    opponent: 'jamie',
    score: [4, 5],
    venue: 'Northline Billiards',
  },
  {
    id: 'm5',
    date: '2026-10-10',
    opponent: 'sam',
    score: [5, 2],
    venue: 'The Green Room',
  },
  {
    id: 'm4',
    date: '2026-10-06',
    opponent: 'jamie',
    score: [5, 1],
    venue: 'The Green Room',
  },
  {
    id: 'm3',
    date: '2026-10-02',
    opponent: 'riley',
    score: [2, 5],
    venue: 'Northline Billiards',
  },
  {
    id: 'm2',
    date: '2026-09-25',
    opponent: 'jamie',
    score: [3, 5],
    venue: 'The Green Room',
  },
  {
    id: 'm1',
    date: '2026-09-19',
    opponent: 'sam',
    score: [5, 3],
    venue: 'Northline Billiards',
  },
]
export const won = (m: Match) => m.score[0] > m.score[1]
export function stats(list: Match[]) {
  const wins = list.filter(won).length
  return {
    wins,
    losses: list.length - wins,
    rate: list.length ? Math.round((wins / list.length) * 100) : 0,
  }
}
export function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}
export const navigate = (path: string) => {
  window.location.hash = path
}
