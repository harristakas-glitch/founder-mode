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
  const avatar = (md.avatar_url as string) || (md.picture as string) || null
  return { name: String(name).slice(0, 24), avatar }
}

export async function currentProfile(): Promise<AuthProfile | null> {
  if (!onlineConfigured) return null
  try {
    const { data } = await getClient().auth.getSession()
    return toProfile(data.session?.user ?? null)
  } catch {
    return null
  }
}

export function onAuthChange(cb: (p: AuthProfile | null) => void): void {
  if (!onlineConfigured) return
  getClient().auth.onAuthStateChange((_event, session) => cb(toProfile(session?.user ?? null)))
}

export async function signInWith(provider: AuthProvider): Promise<string | null> {
  if (!onlineConfigured) return 'Online features are not configured.'
  if (location.protocol === 'file:') return 'Sign-in needs the hosted version — open the game at its web address.'
  try {
    const { error } = await getClient().auth.signInWithOAuth({
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
    await getClient().auth.signOut()
  } catch {
    // signing out of a dead session is fine
  }
}
