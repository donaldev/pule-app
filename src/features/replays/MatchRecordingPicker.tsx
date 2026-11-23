import { useEffect, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { SavedFrame } from '../../data/remote/database.types'
import { RecordingUpload } from './RecordingUpload'
import { inspectRecordingTiming, type RecordingTiming } from './recordingGeometry'
import { suggestReplayFrame } from './suggestReplayFrame'

export function MatchRecordingPicker({ userId, frames, eligibleFrames, describeFrame, onClose, onPublished }: {
  userId: string
  frames: SavedFrame[]
  eligibleFrames: SavedFrame[]
  describeFrame?: (frame: SavedFrame) => string
  onClose: () => void
  onPublished: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [timing, setTiming] = useState<RecordingTiming | null>(null)
  const [checking, setChecking] = useState(false)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ frame: SavedFrame; file: File } | null>(null)

  useEffect(() => {
    if (!file) return
    let active = true
    void inspectRecordingTiming(file).then(result => {
      if (active) { setTiming(result); setChecking(false) }
    })
    return () => { active = false }
  }, [file])

  const eligibleIds = new Set(eligibleFrames.map(frame => frame.id))
  const suggestedId = suggestReplayFrame(timing, frames, eligibleIds)
  const suggested = eligibleFrames.find(frame => frame.id === suggestedId)
  const selected = eligibleFrames.find(frame => frame.id === (chosenId ?? suggestedId))

  return <Modal title={confirmed ? `Create replay · Frame ${confirmed.frame.frame_number}` : 'Add frame recording'} onClose={onClose}>
    {confirmed ? <RecordingUpload userId={userId} frame={confirmed.frame} initialFile={confirmed.file}
      onPublished={onPublished} onRemoved={onClose} /> : <div className="replay-frame-picker">
      <label>{file ? 'Choose a different recording' : 'Choose recording'}
        <input type="file" accept="video/mp4,.mp4" onChange={event => {
          const chosen = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!chosen) return
          setFile(chosen)
          setTiming(null)
          setChecking(true)
          setChosenId(null)
        }} />
      </label>
      {file && <>
        <div className="replay-recording-name"><strong>Selected recording</strong><p>{file.name}</p></div>
        <div aria-live="polite">
          {checking ? <p className="annotation">Checking recording time…</p> : suggested ? <div className="replay-frame-suggestion">
            <strong>Suggested frame</strong>
            <p>Frame {suggested.frame_number}</p>
            <p className="annotation">Recording time matches this frame.</p>
          </div> : <p className="annotation">We couldn't confidently match this recording to a frame. Please choose one below.</p>}
        </div>
        <label>Choose frame
          <select value={selected?.id ?? ''} onChange={event => setChosenId(event.currentTarget.value)}>
            <option value="">Select a frame</option>
            {eligibleFrames.map(frame => <option key={frame.id} value={frame.id}>Frame {frame.frame_number}{describeFrame ? ` · ${describeFrame(frame)}` : ''}</option>)}
          </select>
        </label>
        <button type="button" className="button frame-recording-action" disabled={!selected}
          onClick={() => { if (selected) setConfirmed({ frame: selected, file }) }}>
          <Icon name="arrow" />{selected ? `Continue with Frame ${selected.frame_number}` : 'Continue'}
        </button>
      </>}
    </div>}
  </Modal>
}
