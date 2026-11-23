export const replayUploadLimit = 100_000_000

export function assertReplayUploadSize(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > replayUploadLimit) {
    throw Error('Pule accepts replay uploads up to 100 MB. Choose a smaller MP4.')
  }
}
