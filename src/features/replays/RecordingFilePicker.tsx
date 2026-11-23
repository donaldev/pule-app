import { Icon } from '../../components/ui/Icon'

export const recordingSize = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`

export function RecordingFilePicker({ file, onChoose, disabled, savedName }: {
  file?: File | null
  onChoose: (file: File) => void
  disabled?: boolean
  savedName?: string
}) {
  return <label className={`recording-picker${file ? ' recording-picker-selected' : ''}`}>
    <input className="recording-picker-input" type="file" accept="video/mp4,.mp4" disabled={disabled}
      aria-label={file ? 'Change video' : savedName ? `Choose ${savedName} to resume` : 'Choose video'}
      onChange={event => {
        const selected = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (selected) onChoose(selected)
      }} />
    <span className="recording-picker-icon"><Icon name="video" size={22} /></span>
    <span className="recording-picker-detail">
      <strong>{file?.name ?? (savedName ? 'Resume your saved upload' : 'Select your video')}</strong>
      <span>{file ? recordingSize(file.size) : savedName ?? 'MP4 video'}</span>
    </span>
    <span aria-hidden="true" className={file ? 'recording-picker-change' : 'button'}>{file ? 'Change video' : 'Choose video'}</span>
  </label>
}

export function RecordingProgress({ title, detail, percent }: { title: string; detail: string; percent?: number }) {
  return <div className="recording-progress">
    <div role="status"><strong>{title}</strong><p className="annotation">{detail}</p></div>
    <progress max={100} value={percent} aria-label={title} />
    {percent !== undefined && <small aria-hidden="true">{Math.floor(percent)}%</small>}
  </div>
}
