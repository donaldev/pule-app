/** UI preference only: never authorizes access or stores scoring state. */
export function chooseGroup(groups: { id: string }[], current: string, remembered: string) {
  return [current, remembered].find(id => groups.some(g => g.id === id)) ?? groups[0]?.id ?? ''
}
export function readLastGroup(key: string): string {
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}
export function rememberGroup(key: string, id: string) {
  try { window.localStorage.setItem(key, id) } catch { /* Browsing works without preference storage. */ }
}
