import { useRef } from 'react'
import { Icon, type IconName } from '../../components/ui/Icon'

export function RecordingFilePicker({ file, onChoose, disabled, savedName }: {
  file?: File | null
  onChoose: (file: File) => void
  disabled?: boolean
  savedName?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const filename = file?.name ?? savedName

  return <div className="recording-picker">
    <input ref={input} className="recording-picker-input" type="file" accept="video/mp4,.mp4" disabled={disabled}
      aria-label={file ? 'Change video' : 'Choose video'} tabIndex={-1}
      onChange={event => {
        const selected = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (selected) onChoose(selected)
      }} />
    {filename && <span className="recording-picker-name" title={filename}><Icon name="video" size={18} /><span>{filename}</span></span>}
    <button type="button" className={file ? 'text-button' : 'button'} disabled={disabled} onClick={() => input.current?.click()}>
      {file ? 'Change video' : 'Choose video'}
    </button>
  </div>
}

export function RecordingProgress({ title, detail, percent, icon = 'clock', received = false }: {
  title: string
  detail?: string
  percent?: number
  icon?: IconName
  received?: boolean
}) {
  const measured = percent !== undefined
  return <div className="recording-progress">
    <span className="recording-progress-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
    <div className="recording-progress-status" role="status">
      <strong>{title}</strong>
      {detail && <p className="annotation">{detail}</p>}
    </div>
    {!received && <div className="recording-progress-track" role="progressbar" aria-label={title}
      aria-valuenow={measured ? Math.floor(percent) : undefined}>
      <span className={measured ? undefined : 'recording-progress-indeterminate'} style={measured ? { width: `${percent}%` } : undefined} />
    </div>}
  </div>
}
