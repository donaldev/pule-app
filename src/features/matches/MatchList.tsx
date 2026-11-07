import { Avatar } from '../../components/ui/Primitives'
import { Icon } from '../../components/ui/Icon'
import { dateLabel, player, won, type Match } from '../../data/fixtures'
export function MatchList({ list }: { list: Match[] }) {
  return (
    <div className="match-list">
      {list.map((m) => (
        <a className="match-row" key={m.id} href={`#/recap/${m.id}`}>
          <span className={`outcome ${won(m) ? 'win' : ''}`}>
            {won(m) ? 'W' : 'L'}
          </span>
          <Avatar id={m.opponent} />
          <span className="min-w-0 flex-1">
            <strong>vs {player(m.opponent).name}</strong>
            <span className="block muted text-sm">
              {dateLabel(m.date)} · {m.venue}
            </span>
          </span>
          <span className="match-score">
            {m.score[0]}
            <span className="muted"> – </span>
            {m.score[1]}
          </span>
          <Icon name="arrow" size={17} />
        </a>
      ))}
    </div>
  )
}
