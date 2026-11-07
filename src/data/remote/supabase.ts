import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

let client: SupabaseClient<Database, 'app'> | undefined

/** Lazy configuration; public browser key only. */
export function getSupabase() {
  if (client) return client
  const url: unknown = import.meta.env.VITE_SUPABASE_URL
  const key: unknown = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (typeof url !== 'string' || typeof key !== 'string' || !key.trim()) {
    throw new Error('Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.')
  }
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('Supabase project URL is invalid. Check the public project URL in configuration.') }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use the public Supabase project URL without credentials or query parameters.')
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('Supabase URL requires HTTPS, except for local development.')
  }
  let role: unknown
  if (key.split('.').length === 3) {
    try {
      const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      role = (JSON.parse(atob(encoded)) as { role?: unknown }).role
    } catch { throw new Error('Invalid Supabase browser key.') }
    if (role !== 'anon') throw new Error('Only a publishable or legacy anon key may be used in the browser.')
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('Use a Supabase publishable key; secret keys are forbidden in browser configuration.')
  }
  client = createClient<Database, 'app'>(url, key, {
    db: { schema: 'app' },
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  return client
}

/** Freeze the authenticated actor for a queued write, including cross-tab account changes. */
export async function actorAuthorization(expectedUserId: string) {
  const { data, error } = await getSupabase().auth.getSession()
  if (error || !data.session || data.session.user.id !== expectedUserId) {
    throw new Error('Sign back in to the original account before retrying this operation.')
  }
  return `Bearer ${data.session.access_token}`
}
