# Supabase Multiplayer Setup & Deployment Guide

Peeranki reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at Vite build time.
For lowest latency and smooth multiplayer performance, deploy your Supabase project in the **Mumbai, India (`ap-south-1`)** region.

---

## 1. Database Migrations

Apply the SQL files in `supabase/migrations/` in numeric order:

1. `001_multiplayer.sql` creates the room table, RPCs, RLS policies, and Realtime configuration.
2. `002_counting_timestamp.sql` adds the shared count start timestamp.
3. `003_atomic_host_handoff.sql` adds guarded, atomic host failover.
4. `004_online_state_reliability.sql` allows every phase persisted by the client and ends a live 3-player match when a player leaves.
5. `005_idempotent_public_matchmaking.sql` makes public matchmaking retries safe and avoids duplicate-session/name failures.
6. `006_atomic_player_action.sql` stores online shots atomically so stale client snapshots cannot overwrite them.
7. `007_atomic_duel_choice.sql` stores each duel choice under a row lock so simultaneous choices are preserved.
8. `008_authenticated_room_access.sql` removes public table access and restricts room reads and writes to anonymous-authenticated room members.

**Do not stop after migration 001.** It creates the initial table and policies needed by the later migrations; migration 008 replaces those permissive policies and revokes the anonymous role's direct table/RPC access. On the new project, apply all eight migrations in order before connecting a game build.

### Enable guest authentication

In the new Supabase project, open **Authentication → Sign In / Providers → Anonymous Sign-Ins** and enable anonymous sign-ins before launching the game. Peeranki signs players in anonymously and stores the Auth user ID in each room roster. The final RLS policies use that ID to scope room access. Players do not need to register or provide an email address.

This migration provisions:
1. **`public.game_states` table**:
   - `id`: Unique identifier
   - `room_code`: 6-character room code (unique index)
   - `players`: JSONB array of player slots and inventories
   - `max_players`: Room capacity (3 to 10 players)
   - `is_public`: Public matchmaking vs. private friends room
   - `host_session_id`: Host session identifier
   - `current_shooter`: Active turn pointer
   - `countdown`: Turn timer countdown
   - `game_status`: Phase (`waiting`, `playing`, `counting`, `shooting`, `action_requested`, `shot`, `round_won`, `duel`, `finished`)
   - `created_at` & `updated_at`: Timestamps
2. **Row Level Security (RLS)**:
   - After migration 008, only `authenticated` players listed in a room's roster may read or update that room.
   - Direct deletes are not granted. Joining and atomic shot/duel submissions use restricted RPC functions; room-state writes remain available only to members of that room.
3. **Room RPC Functions**:
   - `public.join_private_room(p_room_code, p_player_name, p_session_id)`: Joins an existing room or reconnects an existing session.
   - `public.find_or_create_public_room(p_max_players, p_player_name, p_session_id)`: Atomic matchmaking that joins open lobbies or provisions a new one.
   - `public.touch_player(p_room_code, p_session_id)`: Heartbeat keepalive for connected players.
   - `public.cleanup_stale_players(p_room_code, p_stale_seconds)`: Disconnects abandoned player sessions.
   - `public.leave_room(p_room_code, p_session_id)`: Marks player as disconnected and dead on exit.
4. **Host Handoff RPC**:
   - `public.claim_room_host(p_room_code, p_expected_host_session_id, p_new_host_session_id)` serializes host claims and rejects stale or ineligible candidates.
5. **Realtime Configuration**:
   - Sets `REPLICA IDENTITY FULL` on `public.game_states`.
   - Adds `public.game_states` to the `supabase_realtime` publication for instant state broadcasts.

### How to Apply the Migration in Supabase

1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project.
3. In the left navigation menu, click **SQL Editor**.
4. Click **New Query** (or the **+** button).
5. Open each migration file in numeric order, copy its entire contents, and run it in the SQL Editor.
6. Verify each query succeeds. Do not connect or deploy a game build until migration 008 succeeds.

### How to Verify Database Setup

- **Table**: Go to **Table Editor** > verify `game_states` exists.
- **Database Functions**: Go to **Database** > **Functions** > verify that `join_private_room`, `find_or_create_public_room`, `touch_player`, `cleanup_stale_players`, `leave_room`, and `claim_room_host` are listed with `SECURITY DEFINER`.
- **Realtime**: Go to **Database** > **Publications** > click `supabase_realtime` > ensure `game_states` is listed under Tables.

---

## 2. API Key Security & Build Configuration

1. **Client-Safe vs. Admin Keys**:
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Safe for client apps when Row Level Security (RLS) is enabled on tables.
   - `service_role` key: **NEVER** expose to the client or place in `VITE_` variables. It bypasses all RLS policies and grants full database administrative rights. If detected in `VITE_SUPABASE_PUBLISHABLE_KEY`, Peeranki will reject the build with a security error.
2. **Environment File Protection**:
   - For local development, store keys in `.env` (which is in `.gitignore`):
     ```env
     VITE_SUPABASE_URL=https://your-project.supabase.co
     VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
     ```
   - Android Studio does not receive Cloudflare's build variables. Before creating an APK, place the same project URL and public/anon key in a local `.env.local` file at the repository root. This file is ignored by Git. Then run `npm.cmd run android:build` so Vite builds the configured web app and Capacitor copies it into Android.
3. **No In-Browser Secret Storage**:
   - API keys and service tokens are never stored in browser `localStorage` or `sessionStorage`.

---

## 3. Configuring Cloudflare Deployment (Workers / Pages)

Because Vite embeds `VITE_` variables into client-side JS bundles at **build time**, you must configure the variables before compiling:

### In Cloudflare Dashboard

1. Navigate to **Workers & Pages** > Select your **Peeranki** project.
2. Go to **Settings** > **Variables and Secrets**.
3. Under **Build-time variables** (or Environment Variables):
   - Add `VITE_SUPABASE_URL` = `https://<your-project-id>.supabase.co`
   - Add `VITE_SUPABASE_PUBLISHABLE_KEY` = `<your-anon-publishable-key>`
4. Trigger a new deployment (**Deployments** > **Retry deployment** or push a new commit).

### Local CLI Build

When deploying via Wrangler CLI:
```bash
VITE_SUPABASE_URL="https://your-project.supabase.co" \
VITE_SUPABASE_PUBLISHABLE_KEY="your-anon-key" \
bun run build

# Deploy to Cloudflare Pages:
wrangler pages deploy dist
```

---

## 4. Error Codes & Diagnostic Reference

Peeranki includes a diagnostic modal that surfaces actionable error reports in the game UI:

| Error Code | Cause | Recommended Action |
|---|---|---|
| `CONFIG_MISSING` | `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` missing at build time. | For web, configure Cloudflare build variables and redeploy. For Android, set the variables in local `.env.local`, run `npm.cmd run android:build`, and create a new signed APK. |
| `TABLE_MISSING` | `public.game_states` table not found in Supabase. | Run `supabase/migrations/001_multiplayer.sql` in Supabase SQL Editor. |
| `RPC_MISSING` | A required RPC is missing in Supabase schema cache. | Apply all files in `supabase/migrations/` in numeric order. |
| `ROOM_NOT_FOUND` | Room code does not exist or lobby has closed. | Verify 6-character code with host. |
| `ROOM_FULL` | Room has reached maximum capacity. | Ask host to start a match with higher player count or create a new room. |
| `GAME_IN_PROGRESS` | Battle has already started. | Wait for the round to finish or create a new room. |
| `PERMISSION_DENIED` | Row Level Security (RLS) rejected the request. | Confirm Anonymous Sign-Ins are enabled and all migrations through 008 succeeded. |
| `NETWORK_ERROR` | Network timeout or could not reach Supabase servers. | Check internet connection or verify Supabase project is active (not paused). |

---

## 5. Development Mode Fallback

In development mode (`!isProduction`), if both environment variables are absent, Peeranki falls back to local in-memory rooms and `BroadcastChannel` for same-browser testing across multiple tabs.

In production builds (`isProduction = true`), the game strictly requires the configured Supabase backend and will **never** silently fall back to browser-only storage.

## Global win points and leaderboard
Apply `supabase/migrations/009_global_leaderboard.sql` after migration 008, then rebuild/sync Android. Each completed online match awards 100 points per winner (including ties); eliminations award no global points. Offline matches do not enter global rankings. The menu and match results open the top 100 leaderboard. Rankings follow the current anonymous Supabase user on this installation; clearing app storage creates a new identity.

Results are awarded by a database trigger using the saved room roster, with duplicate protection by room ID and match start time. Leaderboard tables prohibit client writes. The existing game still trusts room members to update room state, so these rankings are casual, not cheat-resistant competitive rankings. Applying the migration and testing an online match against the live database are required before release.
