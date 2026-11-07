import { useState } from 'react'
import { Avatar, Eyebrow, Modal } from '../../components/ui/Primitives'
import { Icon } from '../../components/ui/Icon'
import { matches, stats, won } from '../../data/fixtures'
import { MatchList } from '../matches/MatchList'
export function Profile() {
  const total = stats(matches)
  const [record, setRecord] = useState(false)
  const [details, setDetails] = useState(false)
  let streak = 0
  let best = 0
  for (const m of [...matches].reverse()) {
    streak = won(m) ? streak + 1 : 0
    best = Math.max(best, streak)
  }
  return (
    <>
      <header className="profile-header">
        <div>
          <Eyebrow>The player behind the score</Eyebrow>
          <h1>
            Alex Morgan<span className="profile-dot">.</span>
          </h1>
          <p className="muted">Fictional player · Private demo profile</p>
          <div className="profile-stats">
            <div>
              <strong>
                {total.wins}
                <small>W</small> – {total.losses}
                <small>L</small>
              </strong>
              <span>Recorded results</span>
            </div>
            <div>
              <strong>
                {total.rate}
                <small>%</small>
              </strong>
              <span>Win rate · n = {matches.length}</span>
            </div>
          </div>
        </div>
        <Avatar id="alex" large />
      </header>
      <div className="editorial-grid profile-body">
        <section>
          <div className="section-heading">
            <Eyebrow>The recent rhythm</Eyebrow>
            <a href="#/insights">
              Explore form
              <Icon name="arrow" size={16} />
            </a>
          </div>
          <div className="result-ribbon">
            {matches
              .slice(0, 8)
              .reverse()
              .map((m) => (
                <a
                  key={m.id}
                  href={`#/recap/${m.id}`}
                  className={won(m) ? 'win' : ''}
                  aria-label={`${won(m) ? 'Win' : 'Loss'} ${m.score.join(' to ')} on ${m.date}`}
                >
                  {won(m) ? 'W' : 'L'}
                </a>
              ))}
          </div>
          <p className="annotation">
            Last 8 fictional matches · Oldest → newest · Same provisional format
          </p>
          <div className="section-heading mt-10">
            <Eyebrow>The familiar face</Eyebrow>
          </div>
          <a className="rival-row" href="#/insights?opponent=jamie">
            <Avatar id="jamie" />
            <div className="flex-1">
              <h2>Jamie Park</h2>
              <p className="muted">3 wins each · 6 meetings</p>
            </div>
            <Icon name="arrow" />
          </a>
          <div className="section-heading mt-10">
            <Eyebrow>Recent chapters</Eyebrow>
          </div>
          <MatchList list={matches.slice(0, 3)} />
        </section>
        <aside className="record-section">
          <Eyebrow>Earned, not given</Eyebrow>
          <Icon name="trophy" size={40} />
          <h2>{best} in a row.</h2>
          <p className="muted">
            Your longest winning streak in this fictional record. Small
            milestones. Good memories.
          </p>
          <button className="story-link" onClick={() => setRecord(true)}>
            See the record
            <Icon name="arrow" />
          </button>
          <div className="coverage-note">
            <Eyebrow>A little perspective</Eyebrow>
            <p>
              12 fictional matches, 19 September–2 November 2026. Recorded
              results are not a complete career history.
            </p>
            <button className="text-button" onClick={() => setDetails(true)}>
              About these numbers
              <Icon name="plus" size={16} />
            </button>
          </div>
        </aside>
      </div>
      {record && (
        <Modal title="Two wins. One good run." onClose={() => setRecord(false)}>
          <p>
            Best streak: {best} wins across the 12 ordered fictional results.
            One qualifying run is shown below. A loss breaks the streak in this
            provisional format.
          </p>
          <MatchList list={matches.slice(0, 2)} />
          <p className="annotation">
            Computed from final outcomes, not shots. Matches outside this
            fixture set are unknown.
          </p>
        </Modal>
      )}
      {details && (
        <Modal
          title="The evidence behind the profile"
          onClose={() => setDetails(false)}
        >
          <p>
            {total.wins} wins / {matches.length} fictional completed matches ={' '}
            {total.rate}% after rounding. All samples use the same provisional
            race-to-five format.
          </p>
          <p className="muted">
            Results are illustrative, not imported or verified. No shot
            accuracy, technique, or pressure-handling claim is supported.
          </p>
        </Modal>
      )}
    </>
  )
}
