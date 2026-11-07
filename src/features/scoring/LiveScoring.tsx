import { useState } from 'react'
import { Avatar, Back, Eyebrow, Modal } from '../../components/ui/Primitives'
import { Icon } from '../../components/ui/Icon'
import { navigate, player } from '../../data/fixtures'
import {
  activeFrames,
  scoreOf,
  timeLabel,
  type DemoController,
} from './useDemoMatch'
export function LiveScoring({
  match,
  dispatch,
  mode,
}: DemoController & { mode: string }) {
  const [timeline, setTimeline] = useState(false)
  const [review, setReview] = useState(false)
  const [light, setLight] = useState(false)
  const score = scoreOf(match.events)
  const frames = activeFrames(match.events)
  const finished = Math.max(...score) >= match.target
  const blocked = mode === 'failure' || mode === 'conflict'
  const latest = match.events.at(-1)
  return (
    <div className={`live-page ${light ? 'scoring-light' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <Back children="Leave table" />
        <button
          className="icon-button"
          onClick={() => setLight(!light)}
          aria-label={
            light ? 'Use dark scoring theme' : 'Use bright venue theme'
          }
        >
          <Icon name={light ? 'moon' : 'sun'} />
        </button>
      </div>
      <header className="live-header">
        <Eyebrow>{match.venue} · Demo table 04</Eyebrow>
        <div className="flex items-center justify-center gap-3 mt-3">
          <span className="status-dot" />
          <span>{match.completed ? 'Completed demo' : 'At the table'}</span>
          <span className="muted">/ Race to {match.target}</span>
        </div>
      </header>
      <section className="score-table rail" aria-label="Live scoreboard">
        <div className="score-pair">
          {match.players.map((id, i) => (
            <div className="score-side" key={id}>
              <Avatar id={id} />
              <h1>{player(id).name}</h1>
              <span className="side-label">PLAYER {i + 1}</span>
              <span className="big-score">{score[i]}</span>
              <div
                className="frame-dots"
                aria-label={`${score[i]} of ${match.target} frames`}
              >
                {Array.from({ length: match.target }, (_, j) => (
                  <i key={j} className={j < score[i] ? 'filled' : ''} />
                ))}
              </div>
              <button
                className={`award-button ${i === 1 ? 'award-second' : ''}`}
                disabled={finished || blocked || match.completed}
                onClick={() => dispatch({ type: 'award', side: i as 0 | 1 })}
              >
                <Icon name="plus" />
                Frame to {player(id).name.split(' ')[0]}
              </button>
            </div>
          ))}
        </div>
        <span className="score-divider" aria-hidden="true">
          :
        </span>
      </section>
      <p className="last-action" aria-live="polite">
        {finished
          ? 'Target reached. Review the result before completing.'
          : latest?.type === 'undo'
            ? 'Last frame undone. You’re back on track.'
            : latest?.type === 'frame'
              ? `Last recorded: frame to ${player(match.players[latest.side]).name.split(' ')[0]}.`
              : 'A fresh table. Award the first frame.'}
      </p>
      <div className="live-controls">
        <button
          className="button button-secondary"
          disabled={!frames.length || match.completed || blocked}
          onClick={() => dispatch({ type: 'undo' })}
        >
          <Icon name="undo" />
          Undo
        </button>
        <button
          className="timer-button"
          disabled={match.completed}
          onClick={() => dispatch({ type: 'pause' })}
          aria-label={`${match.paused ? 'Resume' : 'Pause'} timer`}
        >
          <Icon name={match.paused ? 'play' : 'pause'} />
          <span>{timeLabel(match.seconds)}</span>
          <small>{match.paused ? 'Paused' : 'Pause timer'}</small>
        </button>
        <button
          className="button button-secondary"
          onClick={() => setTimeline(true)}
        >
          <Icon name="matches" />
          Timeline
        </button>
      </div>
      <div className="live-footer">
        <span className="muted text-sm">
          {mode === 'offline'
            ? 'Offline preview · no sync attempted'
            : blocked
              ? 'Simulation: scoring blocked'
              : 'In memory only · not saved'}
          <br />
          Provisional frame rules · refresh resets progress
        </span>
        <button
          className="text-button"
          onClick={() =>
            match.completed ? navigate('/recap/current') : setReview(true)
          }
        >
          {match.completed ? 'View recap' : 'Review match'}
          <Icon name="arrow" />
        </button>
      </div>
      {timeline && (
        <Modal title="The match so far" onClose={() => setTimeline(false)}>
          <p className="muted text-sm">
            In-memory demo journal. Undo events remain visible.
          </p>
          {!match.events.length && <p>No frames yet.</p>}
          <ol className="timeline">
            {match.events.map((e) => (
              <li key={e.id}>
                <span className="muted">
                  {String(e.id + 1).padStart(2, '0')}
                </span>
                <span>
                  {e.type === 'undo'
                    ? `Undid action ${e.target + 1}`
                    : `Frame to ${player(match.players[e.side]).name}`}
                </span>
                <Icon name={e.type === 'undo' ? 'undo' : 'check'} size={16} />
              </li>
            ))}
          </ol>
          <p className="annotation">
            Earlier-event editing is not implemented in this visual prototype.
          </p>
        </Modal>
      )}
      {review && (
        <Modal title="A good place to finish?" onClose={() => setReview(false)}>
          <div className="review-score">{score.join(' – ')}</div>
          <p>
            {finished
              ? `${player(match.players[score[0] > score[1] ? 0 : 1]).name} has reached the provisional target.`
              : `Neither player has reached ${match.target} frames. Keep playing or return Home; the demo remains in memory.`}
          </p>
          <p className="annotation">
            This result is fictional and will not be saved or synchronized.
          </p>
          <button
            className="button w-full"
            disabled={!finished || blocked}
            onClick={() => {
              dispatch({ type: 'complete' })
              navigate('/recap/current')
            }}
          >
            Complete demo match
            <Icon name="check" />
          </button>
          <button
            className="button button-secondary w-full mt-3"
            onClick={() => setReview(false)}
          >
            Back to scoring
          </button>
        </Modal>
      )}
    </div>
  )
}
