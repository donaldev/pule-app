import { useEffect, useId, useRef, type ReactNode } from 'react'
import { player, navigate, type PlayerId } from '../../data/fixtures'
import { Icon } from './Icon'
export function Avatar({
  id,
  large = false,
}: {
  id: PlayerId
  large?: boolean
}) {
  const p = player(id)
  return (
    <span
      aria-hidden="true"
      className={`avatar ${p.color} ${large ? 'avatar-large' : ''}`}
    >
      {p.initials}
    </span>
  )
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>
}
export function LinkButton({
  children,
  to,
  secondary = false,
}: {
  children: ReactNode
  to: string
  secondary?: boolean
}) {
  return (
    <a
      href={`#${to}`}
      className={`button ${secondary ? 'button-secondary' : ''}`}
    >
      {children}
      <Icon name="arrow" />
    </a>
  )
}
export function PageHeading({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children?: ReactNode
}) {
  return (
    <header className="page-heading">
      <Eyebrow>{label}</Eyebrow>
      <h1>{title}</h1>
      {children && <p className="muted max-w-xl">{children}</p>}
    </header>
  )
}
export function Back({
  to = '/play',
  children = 'Back to the table',
}: {
  to?: string
  children?: ReactNode
}) {
  return (
    <a className="back-link" href={`#${to}`}>
      <Icon name="back" />
      {children}
    </a>
  )
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current!
    d.showModal()
    return () => d.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={e => { e.preventDefault(); onClose() }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="modal"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function StatePanel({ state }: { state: 'empty' | 'loading' }) {
  return (
    <section className="state-panel" role="status">
      {state === 'loading' ? (
        <>
          <span className="spinner" />
          <h2>Finding the story…</h2>
          <p className="muted">
            Loading preview. Choose “Ready” in the state control to continue.
          </p>
        </>
      ) : (
        <>
          <span className="empty-mark">◇</span>
          <h2>Your story starts here.</h2>
          <p className="muted">
            No matches in this preview. Start a fictional match to explore
            scoring.
          </p>
          <button className="button" onClick={() => navigate('/setup')}>
            Set up a match
            <Icon name="arrow" />
          </button>
        </>
      )}
    </section>
  )
}
