import { useEffect, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Primitives'
import type { SavedFrame } from '../../data/remote/database.types'
import { RecordingFilePicker, RecordingProgress } from './RecordingFilePicker'
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
  const [selection, setSelection] = useState(0)
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
  }, [file, selection])

  const eligibleIds = new Set(eligibleFrames.map(frame => frame.id))
  const suggestedId = suggestReplayFrame(timing, frames, eligibleIds)
  const suggested = eligibleFrames.find(frame => frame.id === suggestedId)
  const selected = eligibleFrames.find(frame => frame.id === (chosenId ?? suggestedId))

  function chooseVideo(next: File) {
    setFile(next)
    setSelection(n => n + 1)
    setTiming(null)
    setChecking(true)
    setChosenId(null)
    setConfirmed(null)
  }

  return <Modal title={confirmed ? `Create replay · Frame ${confirmed.frame.frame_number}` : 'Add a recording'} onClose={onClose}>
    {confirmed ? <RecordingUpload userId={userId} frame={confirmed.frame} initialFile={confirmed.file} initialTiming={timing ?? (checking ? undefined : null)}
      onPublished={onPublished} onRemoved={onClose} onReplaceVideo={chooseVideo} /> : <div className="replay-frame-picker">
      {!file && <p>Choose a video of your pool frame. Pule will help you match it and mark the table.</p>}
      <RecordingFilePicker file={file} onChoose={chooseVideo} />
      {!file && import.meta.env?.VITE_RECORDING_UPLOAD_API_URL && <p className="annotation">Videos over 100 MB are compressed on your device before upload.</p>}
      {file && <>
        <div aria-live="polite">
          {checking ? <RecordingProgress title="Reading video details" detail="Matching the recording time to your frames." /> : suggested ? <div className="replay-frame-suggestion">
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
        <button type="button" className="button frame-recording-action" disabled={!selected || checking}
          onClick={() => { if (selected) setConfirmed({ frame: selected, file }) }}>
          <Icon name="arrow" />{selected ? `Continue with Frame ${selected.frame_number}` : 'Continue'}
        </button>
      </>}
    </div>}
  </Modal>
}
