# Supabase deployment

Peeranki reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at Vite
build time. For lowest latency and smooth multiplayer performance, deploy your
Supabase project in the **Mumbai, India (`ap-south-1`)** region.
Set both values in the build environment for local web, Android,
desktop, and hosted deployments. Rebuild after changing them. Use the Supabase
publishable/anon key; never place a service-role key in a client build.

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
