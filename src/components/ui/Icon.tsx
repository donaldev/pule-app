export type IconName =
  | 'arrow'
  | 'back'
  | 'play'
  | 'pause'
  | 'plus'
  | 'undo'
  | 'chart'
  | 'user'
  | 'matches'
  | 'home'
  | 'check'
  | 'close'
  | 'sun'
  | 'moon'
  | 'wifi'
  | 'trophy'
  | 'share'
const paths: Record<IconName, string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  play: 'm9 5 11 7-11 7V5Z',
  pause: 'M8 5v14M16 5v14',
  plus: 'M12 5v14M5 12h14',
  undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14',
  chart: 'M4 19V5m0 14h17M8 14l4-5 4 2 5-7',
  user: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 5a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  matches: 'M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4',
  home: 'm3 10 9-7 9 7v11h-7v-7h-4v7H3V10Z',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',
  wifi: 'M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0m-3 4h.01M3 3l18 18',
  trophy:
    'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8',
  share: 'M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8',
}
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
