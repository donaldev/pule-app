import { useState } from 'react'
import { Eyebrow, PageHeading } from '../../components/ui/Primitives'
import {
  matches,
  player,
  stats,
  dateLabel,
  type PlayerId,
} from '../../data/fixtures'
import { MatchList } from '../matches/MatchList'
export function Insights() {
  const [opponent, setOpponent] = useState(() =>
    window.location.hash.includes('opponent=jamie') ? 'jamie' : 'all',
  )
  const [period, setPeriod] = useState('all')
  const [tab, setTab] = useState(() =>
    window.location.hash.includes('opponent=jamie') ? 'rivalry' : 'results',
  )
  const [evidence, setEvidence] = useState(false)
  const eligible = matches.filter(
    (m) =>
      (opponent === 'all' || m.opponent === opponent) &&
      (period === 'all' || m.date >= '2026-10-01'),
  )
  const summary = stats(eligible)
  const buckets = [
    { label: 'September', prefix: '2026-09' },
    { label: 'October', prefix: '2026-10' },
    { label: 'November', prefix: '2026-11' },
  ].map((b) => ({
    ...b,
    list: eligible.filter((m) => m.date.startsWith(b.prefix)),
  }))
  return (
    <>
      <PageHeading label="A little perspective" title="Know your game.">
        Useful questions. Honest answers. A story built from results, never
        guesses about your shots.
      </PageHeading>
      <div
        className="insight-tabs"
        role="tablist"
        aria-label="Insight question"
      >
        {[
          ['results', 'Your results'],
          ['rivalry', 'Head to head'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls="insight-panel"
            id={`tab-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return
              event.preventDefault()
              const next =
                event.key === 'Home'
                  ? 'results'
                  : event.key === 'End'
                    ? 'rivalry'
                    : tab === 'results'
                      ? 'rivalry'
                      : 'results'
              setTab(next)
              if (next === 'rivalry' && opponent === 'all') setOpponent('jamie')
              document.getElementById(`tab-${next}`)?.focus()
            }}
            onClick={() => {
              setTab(id)
              if (id === 'rivalry' && opponent === 'all') setOpponent('jamie')
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <label>
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">All recorded history</option>
            <option value="recent">October onwards</option>
          </select>
        </label>
        <label>
          Opponent
          <select
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
          >
            {tab !== 'rivalry' && <option value="all">All opponents</option>}
            {(['jamie', 'riley', 'sam'] as PlayerId[]).map((id) => (
              <option key={id} value={id}>
                {player(id).name}
              </option>
            ))}
          </select>
        </label>
        <span className="tag">Race to 5 · Demo format</span>
      </div>
      <section
        id="insight-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="insight-layout"
      >
        <div className="insight-answer">
          <Eyebrow>
            {tab === 'rivalry'
              ? `Alex vs ${player(opponent as PlayerId).name}`
              : 'How have my results changed?'}
          </Eyebrow>
          <h2>
            {summary.wins}
            <span>
              {' '}
              wins from
              <br />
              {eligible.length} meetings.
            </span>
          </h2>
          <div className="insight-rate">
            {summary.rate}
            <span>%</span>
            <small>win rate</small>
          </div>
          <p className="muted">
            {tab === 'rivalry' && summary.wins === summary.losses
              ? 'A level series. Plenty left to play for.'
              : `${summary.wins} wins and ${summary.losses} losses in the selected fictional record.`}
          </p>
          <p className="annotation">
            n = {eligible.length} · Small, selected sample. Results vary with
            opponents; this does not establish a change in ability.
          </p>
        </div>
        <div className="chart-section">
          <div className="section-heading">
            <Eyebrow>Results by month</Eyebrow>
            <span className="muted text-sm">Wins / played</span>
          </div>
          <div className="bar-chart" aria-hidden="true">
            {buckets.map((b) => {
              const s = stats(b.list)
              return (
                <div className="bar-column" key={b.prefix}>
                  <span>
                    {s.wins}/{b.list.length}
                  </span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ height: `${s.rate}%` }}
                    />
                  </div>
                  <small>{b.label.slice(0, 3)}</small>
                </div>
              )
            })}
          </div>
          <table className="data-table">
            <caption className="sr-only">
              Accessible monthly results for the selected fictional matches
            </caption>
            <thead>
              <tr>
                <th>Month</th>
                <th>Won</th>
                <th>Played</th>
                <th>Win rate</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => {
                const s = stats(b.list)
                return (
                  <tr key={b.prefix}>
                    <th>{b.label}</th>
                    <td>{s.wins}</td>
                    <td>{b.list.length}</td>
                    <td>{b.list.length ? `${s.rate}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="insight-evidence">
        <Eyebrow>What the numbers can tell you</Eyebrow>
        <p>
          Win rate is wins divided by eligible completed matches. These are
          fictional results from 19 September–2 November 2026, not a
          representative sample. No shot-level data is recorded.
        </p>
        <button
          className="text-button"
          onClick={() => setEvidence(!evidence)}
          aria-expanded={evidence}
        >
          {evidence ? 'Hide' : 'View'} {eligible.length} contributing matches{' '}
          <span aria-hidden="true">{evidence ? '−' : '+'}</span>
        </button>
        {evidence && (
          <>
            <p className="annotation">
              Filtered date coverage: {dateLabel(eligible.at(-1)!.date)}–
              {dateLabel(eligible[0].date)} · Fictional fixtures only · No live
              data
            </p>
            <MatchList list={eligible} />
          </>
        )}
      </div>
    </>
  )
}
