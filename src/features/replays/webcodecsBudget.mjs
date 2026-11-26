// CBR is a target, so leave 25 MB below the hard cap, plus 4 MB for MP4 tables.
export function webCodecsVideoRate(duration, audioBytes) {
  const videoBudget = 175_000_000 - 4_000_000 - audioBytes
  const rate = Math.min(8_000_000, Math.floor(videoBudget * 8 / duration))
  if (!Number.isFinite(rate) || rate < 350_000) throw Error('No usable constant bitrate fits the 200 MB limit.')
  return rate
}
