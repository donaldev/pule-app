import { useId, useState } from 'react'
import type { SessionState } from '../../data/remote/database.types'
import { MatchDisclosureHeading } from './MatchDisclosureHeading'
import { calculateTonightsForm } from './tonightsFormData'

const empty = 'Momentum starts after the first frame.'

export function TonightsForm({ state }: { state: SessionState }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const { recent, players, leader, streak } = calculateTonightsForm(state.session.id, state.frames, state.participants)
  const total = recent.length
  const form = !total ? empty : leader
    ? `${leader.name} won ${leader.wins} of the last ${total}`
    : 'Evenly matched recently'
  const summary = streak ? `${streak.name}: ${streak.wins}-frame streak` : form
  const pair = players.length === 2

  return <section className="match-disclosure tonights-form">
    <MatchDisclosureHeading expanded={expanded} controls={id} onToggle={() => setExpanded(value => !value)}>
      <span className="tonights-form-title">Tonight’s Form</span>
      {!expanded && <span className="tonights-form-summary">{summary}</span>}
    </MatchDisclosureHeading>
    <div id={id} hidden={!expanded}>
      <div className="tonights-form-content">
        <p className="tonights-form-streak" data-streak={!!streak}>{streak ? `${streak.name} · ${streak.wins} straight wins` : 'No active streak'}</p>
        <p>{form}</p>
        {total > 0 && <>
          {pair ? <div className="tonights-form-pair">
            <div className="tonights-form-gauge" aria-hidden="true">
              {Array.from({ length: total }, (_, index) => <span key={index} data-side={
                index < players[0].wins ? 'first' : index >= total - players[1].wins ? 'second' : 'none'
              } />)}
            </div>
            <div className="tonights-form-pair-labels">
              {players.map((player, index) => <span key={player.id}><i aria-hidden="true" data-side={index === 0 ? 'first' : 'second'} />
                {player.name} <strong>{player.wins}</strong></span>)}
            </div>
          </div> : <ul className="tonights-form-ranked" aria-label="Recent wins by player">
            {players.map(player => <li key={player.id}>
              <span>{player.name}</span>
              <span className="tonights-form-bar" aria-hidden="true"><span style={{ width: `${player.wins * 100 / total}%` }} /></span>
              <strong>{player.wins} {player.wins === 1 ? 'win' : 'wins'}</strong>
            </li>)}
          </ul>}
          <div>
            <h3>Recent frames</h3>
            <ol className="tonights-form-results">
              {recent.map(frame => <li key={frame.id}>
                <span>Frame {frame.number}</span>
                <strong><i aria-hidden="true" data-side={frame.hasWinner ? 'first' : 'none'} />{frame.result}</strong>
              </li>)}
            </ol>
          </div>
        </>}
      </div>
    </div>
  </section>
}
