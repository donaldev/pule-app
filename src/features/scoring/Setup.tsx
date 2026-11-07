import { useState } from 'react'
import {
  Avatar,
  Back,
  Eyebrow,
  Modal,
  PageHeading,
} from '../../components/ui/Primitives'
import { Icon } from '../../components/ui/Icon'
import { navigate, players, type PlayerId } from '../../data/fixtures'
import type { DemoController } from './useDemoMatch'
export function Setup({ match, dispatch }: DemoController) {
  const [first, setFirst] = useState<PlayerId>(match.players[0])
  const [second, setSecond] = useState<PlayerId>(match.players[1])
  const [target, setTarget] = useState(match.target)
  const [venue, setVenue] = useState(match.venue)
  const [confirm, setConfirm] = useState(false)
  function start() {
    dispatch({ type: 'start', players: [first, second], target, venue })
    navigate('/live')
  }
  return (
    <div className="narrow-page">
      <Back />
      <PageHeading label="A new chapter" title="Who's at the table?">
        Good company. A little competition. Let's play.
      </PageHeading>
      <div className="setup-players">
        {([0, 1] as const).map((side) => (
          <label key={side} className="player-select">
            <Eyebrow>Player {side + 1}</Eyebrow>
            <Avatar id={side === 0 ? first : second} large />
            <select
              aria-label={`Player ${side + 1}`}
              value={side === 0 ? first : second}
              onChange={(e) =>
                side === 0
                  ? setFirst(e.target.value as PlayerId)
                  : setSecond(e.target.value as PlayerId)
              }
            >
              {players.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  disabled={p.id === (side === 0 ? second : first)}
                >
                  {p.name}
                </option>
              ))}
            </select>
            <span className="muted text-sm">Fictional player</span>
          </label>
        ))}
        <span className="versus">VS</span>
      </div>
      <section className="setup-rules">
        <Eyebrow>The shape of the match</Eyebrow>
        <div className="field-row">
          <span>
            <strong>Frame scoring</strong>
            <span className="block muted text-sm">
              One tap awards one frame
            </span>
          </span>
          <span className="tag">Provisional</span>
        </div>
        <label className="field-row">
          <span>Race to</span>
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            aria-label="Frames to win"
          >
            <option value={3}>3 frames</option>
            <option value={5}>5 frames</option>
            <option value={7}>7 frames</option>
          </select>
        </label>
        <label className="field-row">
          <span>Venue</span>
          <select value={venue} onChange={(e) => setVenue(e.target.value)}>
            <option>The Green Room</option>
            <option>Northline Billiards</option>
          </select>
        </label>
      </section>
      <p className="annotation">
        Unvalidated interaction hypothesis. No break, turn, handicap or
        shot-level rules are assumed. Both venues are fictional.
      </p>
      <button
        className="button w-full mt-6"
        disabled={first === second}
        onClick={() =>
          !match.completed && match.events.length ? setConfirm(true) : start()
        }
      >
        Let's play
        <Icon name="arrow" />
      </button>
      <p className="muted text-sm text-center mt-4">
        Demo only · Refresh resets the match
      </p>
      {confirm && (
        <Modal title="Start a fresh demo?" onClose={() => setConfirm(false)}>
          <p>
            The current in-memory match will be replaced. This prototype does
            not save drafts.
          </p>
          <button className="button w-full" onClick={start}>
            Start fresh
            <Icon name="arrow" />
          </button>
          <button
            className="button button-secondary w-full mt-3"
            onClick={() => setConfirm(false)}
          >
            Keep current match
          </button>
        </Modal>
      )}
    </div>
  )
}
