import type { ReplayUploadStatus } from '../../data/remote/database.types'
export function recordingLabel(status: ReplayUploadStatus | null) {
  if (!status) return 'Choose one complete frame recording.'
  if (['cleanup', 'cleaned'].includes(status.status)) return 'This recording has expired or been removed.'
  if (!status.processing_status) return 'Recording reserved. Resume uploading the same file.'
  return ({ uploaded: 'Recording uploaded. Select the four table corners to continue.', queued: 'Your replay is queued.', processing: 'Your replay is being created.', completed: 'Your replay is ready.', failed: 'Processing failed. Check the table corners and try again before the recording expires.' })[status.processing_status ?? 'uploaded'] ?? 'Recording reserved. Resume uploading the same file.'
}
