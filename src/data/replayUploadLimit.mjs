export const directReplayUploadLimit = 200_000_000
export const compressedReplayOutputLimit = 100_000_000

export function assertDirectReplayUploadSize(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > directReplayUploadLimit) {
    throw Error('Direct replay uploads are limited to 200 MB. Compress this video or choose a smaller MP4.')
  }
}
