// Optional social login (Google / X) via Supabase Auth.
// The game never requires it — signing in upgrades your leaderboard identity
// from an anonymous row to your handle + avatar, and unlocks future profile features.
import { onlineConfigured } from './config'
import { getClient } from './online'

export interface AuthProfile {
  name: string
  avatar: string | null
}

export type AuthProvider = 'google' | 'twitter'

function toProfile(user: { user_metadata?: Record<string, unknown>; email?: string } | null): AuthProfile | null {
  if (!user) return null
  const md = user.user_metadata ?? {}
  const name =
    (md.user_name as string) || // X handle
    (md.preferred_username as string) ||
    (md.full_name as string) ||
    (md.name as string) ||
    user.email?.split('@')[0] ||
    'player'
  return { name: String(name).slice(0, 24), avatar: safeAvatar(md.avatar_url) ?? safeAvatar(md.picture) }
}

/**
 * The avatar goes straight into an <img src>. It arrives as provider metadata rather than from
 * our own code, so it is only ever as trustworthy as whatever the OAuth provider chose to echo
 * back. Allow https: images and nothing else — no data:/blob: payloads, no javascript:, and no
 * plain http: that would downgrade the connection and leak the request.
 */
export function safeAvatar(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 512) return null
  try {
    return new URL(v).protocol === 'https:' ? v : null
  } catch {
    return null // not an absolute URL at all
  }
}

/**
 * The OAuth error the provider sent back in the redirect, if any. supabase-js records the failure
 * internally and the app used to show NOTHING — a player whose sign-in failed at Google or at the
 * Supabase exchange just saw the buttons again, unchanged ("i logged in… nothing changed", owner,
 * 2026-08-22). Read-only: the URL is left for auth-js to parse; we only translate it for humans.
 */
export function oauthReturnError(): string | null {
  try {
    const merge = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    for (const [k, v] of new URLSearchParams(window.location.search)) if (!merge.has(k)) merge.append(k, v)
    const desc = merge.get('error_description') || merge.get('error')
    if (!desc) return null
    return `Sign-in failed: ${decodeURIComponent(desc.replace(/\+/g, ' ')).slice(0, 200)}`
  } catch {
    return null
  }
}

export async function currentProfile(): Promise<AuthProfile | null> {
  if (!onlineConfigured) return null
  try {
    const { data } = await (await getClient()).auth.getSession()
    return toProfile(data.session?.user ?? null)
  } catch {
    return null
  }
}

export function onAuthChange(cb: (p: AuthProfile | null) => void): void {
  if (!onlineConfigured) return
  // fire-and-forget: if the lazy client chunk cannot load there is no session to observe anyway
  getClient()
    .then((c) => c.auth.onAuthStateChange((_event, session) => cb(toProfile(session?.user ?? null))))
    .catch(() => {})
}

export async function signInWith(provider: AuthProvider): Promise<string | null> {
  if (!onlineConfigured) return 'Online features are not configured.'
  if (location.protocol === 'file:') return 'Sign-in needs the hosted version — open the game at its web address.'
  try {
    const { error } = await (await getClient()).auth.signInWithOAuth({
      provider,
      options: { redirectTo: location.origin + location.pathname },
    })
    return error ? error.message : null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export async function signOut(): Promise<void> {
  try {
    await (await getClient()).auth.signOut()
  } catch {
    // signing out of a dead session is fine
  }
}
