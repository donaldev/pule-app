import { Avatar, Eyebrow, LinkButton } from '../../components/ui/Primitives'
import { Icon } from '../../components/ui/Icon'
import { matches, player, stats } from '../../data/fixtures'
import { MatchList } from '../matches/MatchList'
import { scoreOf, type DemoMatch } from '../scoring/useDemoMatch'
export function Home({ match }: { match: DemoMatch }) {
  const score = scoreOf(match.events)
  const rivalry = stats(matches.filter((m) => m.opponent === 'jamie'))
  return (
    <>
      <div className="home-intro flex justify-between items-center gap-4">
        <Eyebrow>A little rivalry. A lot of pool.</Eyebrow>
        <span className="muted text-sm hidden sm:block">
          Tuesday, 3 November
        </span>
      </div>
      <section className="home-hero rail">
        <div className="hero-copy">
          <span className="venue-tag">
            <span className="status-dot" />
            THE GREEN ROOM · FICTIONAL VENUE
          </span>
          <h1>
            Make the
            <br />
            next one
            <br />
            <em>count.</em>
          </h1>
          <p>The table is waiting. Pick up where you left off.</p>
          <LinkButton to={match.completed ? '/setup' : '/live'}>
            {match.completed ? 'Start another match' : 'Resume demo match'}
          </LinkButton>
          <a href="#/setup" className="quiet-link">
            Set up a new match <Icon name="plus" size={16} />
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="table-outline">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="cue-line" />
          <div className="pool-ball">
            <span>8</span>
          </div>
          <div className="cue-ball" />
          <span className="art-caption">THE GAME IS IN THE DETAILS.</span>
        </div>
      </section>
      {!match.completed && (
        <a className="resume-strip" href="#/live">
          <span className="status-dot" />
          <span className="flex-1">
            <strong>On the table</strong>
            <span className="block muted text-sm">
              {player(match.players[0]).name} vs {player(match.players[1]).name}{' '}
              · In-memory demo
            </span>
          </span>
          <span className="match-score">{score.join(' – ')}</span>
          <Icon name="arrow" />
        </a>
      )}
      <div className="editorial-grid">
        <section>
          <div className="section-heading">
            <Eyebrow>The last few meetings</Eyebrow>
            <a href="#/matches">
              All matches <Icon name="arrow" size={16} />
            </a>
          </div>
          <MatchList list={matches.slice(0, 3)} />
        </section>
        <section className="rivalry-story">
          <Eyebrow>Some things deserve a rematch</Eyebrow>
          <div className="flex items-center gap-3 mt-6">
            <Avatar id="alex" />
            <span className="muted text-sm">VS</span>
            <Avatar id="jamie" />
          </div>
          <h2>
            All square.
            <br />
            Never settled.
          </h2>
          <p className="muted">
            Alex & Jamie. {rivalry.wins} wins each across six fictional
            meetings. The next chapter is yours.
          </p>
          <a href="#/insights?opponent=jamie" className="story-link">
            Explore the rivalry <Icon name="arrow" />
          </a>
        </section>
      </div>
    </>
  )
}
