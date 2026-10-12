# Supabase deployment

Peeranki reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at Vite
build time. For lowest latency and smooth multiplayer performance, deploy your
Supabase project in the **Mumbai, India (`ap-south-1`)** region.
Set both values in the build environment for local web, Android,
desktop, and hosted deployments. Rebuild after changing them. Use the Supabase
publishable/anon key; never place a service-role key in a client build.

## API Key Security & Best Practices

1. **Client-Safe vs. Admin Keys**:
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Safe for client apps when Row Level Security (RLS) is enabled on tables.
   - `service_role` key: **NEVER** expose to the client or place in `VITE_` variables. It bypasses all RLS policies and grants full database administrative rights.
2. **Environment File Protection**:
   - Real keys must only be stored in `.env` or deployment environment secret managers.
   - `.env` files are ignored by git (`.gitignore`) to prevent accidental commits to public repositories.
3. **No In-Browser Storage**:
   - API keys and service tokens are never stored in browser `localStorage` or `sessionStorage` where malicious extensions or scripts could access them.
4. **Row Level Security (RLS)**:
   - Ensure RLS is active on `public.game_states` so clients can only update authorized game records through designated RPCs.

Online rooms require the `public.game_states` table and these public RPCs:

- `join_private_room(p_room_code, p_player_name, p_session_id)`
- `find_or_create_public_room(p_max_players, p_player_name, p_session_id)`
- `touch_player(p_room_code, p_session_id)`
- `cleanup_stale_players(p_room_code, p_stale_seconds)`
- `leave_room(p_room_code, p_session_id)`

Enable Supabase Realtime for `public.game_states` so lobby and game state
updates reach other players. In-game shots and duel choices use Realtime
broadcasts on the room channel; the host validates those messages and is the
only client that saves the shared match snapshot. The repository does not
include a database schema migration; provision the table, RPCs, access policies,
and Realtime publication in the Supabase project before deploying multiplayer.

If both environment variables are absent, Peeranki deliberately uses local
in-memory/session-storage rooms and `BroadcastChannel` for same-browser
development. This is not cross-device multiplayer. Partial/invalid
configuration and request failures are surfaced as Supabase errors and do not
switch a configured room to local storage.
