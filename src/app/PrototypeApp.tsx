import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../components/ui/Icon'
import { Avatar, PageHeading, StatePanel } from '../components/ui/Primitives'
import { matches } from '../data/fixtures'
import { Home } from '../features/home/Home'
import { Insights } from '../features/insights/Insights'
import { MatchList } from '../features/matches/MatchList'
import { Recap } from '../features/matches/Recap'
import { Profile } from '../features/players/Profile'
import { LiveScoring } from '../features/scoring/LiveScoring'
import { Setup } from '../features/scoring/Setup'
import { useDemoMatch } from '../features/scoring/useDemoMatch'
const navigation: { to: string; title: string; icon: IconName }[] = [
  { to: '/play', title: 'Play', icon: 'home' },
  { to: '/matches', title: 'Matches', icon: 'matches' },
  { to: '/insights', title: 'Insights', icon: 'chart' },
  { to: '/profile', title: 'Player', icon: 'user' },
]
export default function App() {
  const [route, setRoute] = useState(
    () => window.location.hash.slice(1) || '/play',
  )
  const [mode, setMode] = useState('ready')
  const controller = useDemoMatch()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    function change() {
      setRoute(window.location.hash.slice(1) || '/play')
      window.scrollTo({ top: 0 })
      mainRef.current?.focus()
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const path = route.split('?')[0]
  const live = path === '/live'
  const state = mode === 'empty' || mode === 'loading'
  const nav = (
    <>
      {navigation.map((n) => (
        <a
          key={n.to}
          href={`#${n.to}`}
          className={
            path === n.to || (n.to === '/matches' && path.startsWith('/recap'))
              ? 'active'
              : ''
          }
          aria-current={path === n.to ? 'page' : undefined}
        >
          <Icon name={n.icon} />
          <span>{n.title}</span>
        </a>
      ))}
    </>
  )
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          mainRef.current?.focus()
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="#/play" className="wordmark" aria-label="Pule home">
          pule<span>●</span>
        </a>
        <span className="sidebar-subtitle">THE NEXT FRAME.</span>
        <nav aria-label="Main navigation">{nav}</nav>
        <div className="sidebar-bottom">
          <span className="mini-table" aria-hidden="true">
            ◇
          </span>
          <p>
            A little rivalry.
            <br />A lot of pool.
          </p>
          <span>VISUAL PROTOTYPE / 01</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <a className="wordmark mobile-logo" href="#/play">
            pule<span>●</span>
          </a>
          <div className="topbar-location">
            <span className="tiny-diamond" />
            THE TABLE IS YOURS.
          </div>
          <div className="flex items-center gap-3">
            <span className="prototype-tag">FICTIONAL DEMO</span>
            <a href="#/profile" aria-label="View Alex's fictional profile">
              <Avatar id="alex" />
            </a>
          </div>
        </header>
        <div className="prototype-controls">
          <span>
            Interaction prototype · Fictional people, venues & results
          </span>
          <label>
            Preview state
            <select
              aria-label="Preview state"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="ready">Ready</option>
              <option value="offline">Offline</option>
              <option value="empty">Empty history</option>
              <option value="loading">Loading</option>
              <option value="failure">Save failure</option>
              <option value="conflict">Conflict</option>
            </select>
          </label>
        </div>
        {mode === 'offline' && (
          <div className="notice" role="status">
            <Icon name="wifi" />
            <p>
              <strong>Offline state preview.</strong> Interactions stay in
              memory. No offline caching or synchronization is implemented.
            </p>
          </div>
        )}
        {(mode === 'failure' || mode === 'conflict') && (
          <div className="notice notice-warning" role="alert">
            <Icon name="undo" />
            <p>
              <strong>
                {mode === 'failure'
                  ? 'Simulated save failure.'
                  : 'Simulated conflicting drafts.'}
              </strong>{' '}
              Scoring is blocked in this preview. Choose Ready to recover. No
              actual save or merge is attempted.
            </p>
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          ref={mainRef}
          className={`main-content ${live ? 'main-live' : ''}`}
        >
          <div className="screen" key={path}>
            {state && !['/setup', '/live'].includes(path) ? (
              <StatePanel state={mode as 'empty' | 'loading'} />
            ) : path === '/play' ? (
              <Home match={controller.match} />
            ) : path === '/setup' ? (
              <Setup {...controller} />
            ) : live ? (
              <LiveScoring {...controller} mode={mode} />
            ) : path.startsWith('/recap/') ? (
              <Recap id={path.split('/')[2]} match={controller.match} />
            ) : path === '/profile' ? (
              <Profile />
            ) : path === '/insights' ? (
              <Insights key={route} />
            ) : path === '/matches' ? (
              <>
                <PageHeading
                  label="Every match, a chapter"
                  title="Back at the table."
                >
                  Twelve fictional meetings. One growing story. All use the same
                  provisional frame format.
                </PageHeading>
                <MatchList list={matches} />
              </>
            ) : (
              <>
                <PageHeading
                  label="Off the table"
                  title="This page isn't in play."
                />
                <a className="button" href="#/play">
                  Go Home
                  <Icon name="arrow" />
                </a>
              </>
            )}
          </div>
        </main>
        <footer className="app-footer">
          <span>PULE — THE NEXT FRAME.</span>
          <span>
            Visual prototype · Rules unvalidated · Refresh resets progress
          </span>
        </footer>
      </div>
      {!live && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {nav}
        </nav>
      )}
    </div>
  )
}
