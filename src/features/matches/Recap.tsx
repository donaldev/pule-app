import { useState } from 'react'
import {
  Avatar,
  Back,
  Eyebrow,
  LinkButton,
  Modal,
  PageHeading,
} from '../../components/ui/Primitives'
import { Icon } from '../../components/ui/Icon'
import { dateLabel, matches, player, type Side } from '../../data/fixtures'
import { activeFrames, scoreOf, type DemoMatch } from '../scoring/useDemoMatch'
export function Recap({ id, match }: { id: string; match: DemoMatch }) {
  const [share, setShare] = useState(false)
  const [redact, setRedact] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const sample = matches.find((m) => m.id === id)
  const current = id === 'current'
  const score = current ? scoreOf(match.events) : sample?.score
  const ids = current
    ? match.players
    : (['alex', sample?.opponent ?? 'jamie'] as const)
  if (!score || (current && !match.completed))
    return (
      <>
        <Back />
        <PageHeading
          label="Not ready yet"
          title="The story is still unfolding."
        >
          Complete your demo match to see its recap.
        </PageHeading>
        <LinkButton to="/live">Back to the table</LinkButton>
      </>
    )
  const frames: Side[] | undefined = current
    ? activeFrames(match.events).map((e) => e.side)
    : sample?.frames
  const winner: Side = score[0] > score[1] ? 0 : 1
  const fullNames = ids.map((id) => player(id).name)
  const displayNames = redact ? ids.map((id) => player(id).initials) : fullNames
  let tally = [0, 0]
  let maxDeficit = 0
  frames?.forEach((side) => {
    tally = tally.map((s, i) => s + (side === i ? 1 : 0))
    maxDeficit = Math.max(maxDeficit, tally[1 - winner] - tally[winner])
  })
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `PULE · FICTIONAL DEMO RESULT\n${displayNames[0]} ${score![0]} – ${score![1]} ${displayNames[1]}\nProvisional frame rules · Not an official result`,
      )
      setCopied(true)
    } catch {
      setCopyError(true)
    }
  }
  return (
    <>
      <Back
        to={current ? '/live' : '/matches'}
        children={current ? 'Back to demo table' : 'Back to matches'}
      />
      <div className="recap-layout">
        <section className="recap-poster rail">
          <Eyebrow>A match to remember</Eyebrow>
          <span className="tag mt-5">
            {current ? 'Completed in memory' : 'Fictional sample result'}
          </span>
          <div className="recap-names">
            {ids.map((id, i) => (
              <div key={id}>
                <Avatar id={id} />
                <h2>{fullNames[i]}</h2>
                <span className="recap-number">{score[i]}</span>
                <span className="eyebrow">
                  {winner === i ? 'WINNER' : 'A WORTHY OPPONENT'}
                </span>
              </div>
            ))}
          </div>
          <p className="recap-caption">
            {current ? match.venue : sample?.venue}
            <br />
            {current ? 'Your demo session' : dateLabel(sample!.date)} · Race to{' '}
            {current ? match.target : 5} · Provisional rules
          </p>
          <span className="poster-wordmark">
            pule<span>●</span>
          </span>
        </section>
        <section className="recap-story">
          <Eyebrow>The story of this match</Eyebrow>
          <h1>
            {maxDeficit > 0 ? (
              <>
                A different ending.
                <br />
                <em>A great comeback.</em>
              </>
            ) : (
              <>
                {fullNames[winner].split(' ')[0]} takes
                <br />
                <em>this chapter.</em>
              </>
            )}
          </h1>
          <p className="muted">
            {frames && maxDeficit > 0
              ? `${fullNames[winner]} recovered from a ${maxDeficit}-frame deficit to win ${score[winner]}–${score[1 - winner]}. A score story, not a claim about shot quality.`
              : frames
                ? 'A complete demo frame sequence tells the result. Every frame is shown below.'
                : 'A result worth keeping. This sample has final scores only; no comeback or shot-level story can be established.'}
          </p>
          {frames ? (
            <div className="progression">
              <Eyebrow>Frame by frame</Eyebrow>
              <div className="frame-strip">
                {frames.map((side, i) => (
                  <span
                    className={side === 0 ? 'frame-a' : 'frame-b'}
                    key={i}
                    title={`Frame ${i + 1}: ${fullNames[side]}`}
                  >
                    {i + 1}
                    <small>{player(ids[side]).initials}</small>
                  </span>
                ))}
              </div>
              <p className="annotation">
                Ordered frame winners · {frames.length} fictional events · No
                shot data
              </p>
            </div>
          ) : (
            <p className="annotation mt-6">
              Result-only fixture · Event history not recorded
            </p>
          )}
          <div className="grid gap-3 mt-8">
            <button className="button" onClick={() => setShare(true)}>
              <Icon name="share" />
              Preview share result
              <Icon name="arrow" />
            </button>
            <LinkButton to="/setup" secondary>
              Play again
            </LinkButton>
          </div>
          <p className="annotation mt-4">
            Prototype result. Not server-confirmed. Sharing is a local text
            preview.
          </p>
        </section>
      </div>
      {share && (
        <Modal title="A result worth sharing" onClose={() => setShare(false)}>
          <p className="muted">Preview only. Nothing is published or sent.</p>
          <div className="share-preview">
            <Eyebrow>PULE / FICTIONAL DEMO</Eyebrow>
            <h2>
              {displayNames[0]}
              <span className="block share-score">{score.join(' – ')}</span>
              {displayNames[1]}
            </h2>
            <p>Provisional frame rules · Not an official result</p>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={redact}
              onChange={(e) => {
                setRedact(e.target.checked)
                setCopied(false)
              }}
            />
            Use initials only
          </label>
          <button className="button w-full" onClick={copy}>
            {copied ? 'Demo result copied' : 'Copy demo result text'}
            <Icon name={copied ? 'check' : 'share'} />
          </button>
          {copyError && (
            <p role="status">
              Clipboard unavailable. You can select and copy the preview text
              above.
            </p>
          )}
          <p className="annotation mt-4">
            Image export and public links are not implemented. Copied text
            cannot be recalled.
          </p>
        </Modal>
      )}
    </>
  )
}
