// Online multiplayer backend (Supabase Realtime).
//
// To enable online play:
//   1. Create a free project at https://supabase.com (any name, any region).
//   2. In the project: Settings → API → copy "Project URL" and the "anon public" key.
//   3. Paste them below and redeploy. That's it — no tables, no SQL; the game only
//      uses Realtime channels (broadcast + presence), which work out of the box.
// The anon key is designed to be public — shipping it in the client is normal.

export const SUPABASE_URL = 'https://rgxwsffpfsvcpqgvogkl.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_Z7TmXookH7bLzesT4ohNLA_6DWmmU_r'

export const ROUND_SECONDS = 150 // each round: everyone plays their week, 2.5 min max

export const onlineConfigured = !SUPABASE_URL.includes('YOUR-') && !SUPABASE_ANON_KEY.includes('YOUR-')
