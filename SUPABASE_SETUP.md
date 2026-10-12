# Supabase Multiplayer Setup & Deployment Guide

Peeranki reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at Vite build time.
For lowest latency and smooth multiplayer performance, deploy your Supabase project in the **Mumbai, India (`ap-south-1`)** region.

---

## 1. Database Migration (`supabase/migrations/001_multiplayer.sql`)

The repository includes a production-ready SQL migration file:
`supabase/migrations/001_multiplayer.sql`

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
   - `game_status`: Status (`waiting`, `playing`, `shooting`, `counting`, `duel`, `finished`)
   - `created_at` & `updated_at`: Timestamps
2. **Row Level Security (RLS)**:
   - SELECT, INSERT, and UPDATE policies granted to `anon` and `authenticated` roles.
3. **5 Public Database RPC Functions**:
   - `public.join_private_room(p_room_code, p_player_name, p_session_id)`: Joins an existing room or reconnects an existing session.
   - `public.find_or_create_public_room(p_max_players, p_player_name, p_session_id)`: Atomic matchmaking that joins open lobbies or provisions a new one.
   - `public.touch_player(p_room_code, p_session_id)`: Heartbeat keepalive for connected players.
   - `public.cleanup_stale_players(p_room_code, p_stale_seconds)`: Disconnects abandoned player sessions.
   - `public.leave_room(p_room_code, p_session_id)`: Marks player as disconnected and dead on exit.
4. **Realtime Configuration**:
   - Sets `REPLICA IDENTITY FULL` on `public.game_states`.
   - Adds `public.game_states` to the `supabase_realtime` publication for instant state broadcasts.

### How to Apply the Migration in Supabase

1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project.
3. In the left navigation menu, click **SQL Editor**.
4. Click **New Query** (or the **+** button).
5. Open `supabase/migrations/001_multiplayer.sql` from this repository, copy its entire contents, and paste into the SQL Editor.
6. Click **Run** (or press `Cmd + Enter` / `Ctrl + Enter`).
7. Verify that the query executes successfully with status `Success: No rows returned`.

### How to Verify Database Setup

- **Table**: Go to **Table Editor** > verify `game_states` exists.
- **Database Functions**: Go to **Database** > **Functions** > verify that `join_private_room`, `find_or_create_public_room`, `touch_player`, `cleanup_stale_players`, and `leave_room` are listed with `SECURITY DEFINER`.
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
| `CONFIG_MISSING` | `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` missing at build time. | Configure variables in Cloudflare build settings and redeploy. |
| `TABLE_MISSING` | `public.game_states` table not found in Supabase. | Run `supabase/migrations/001_multiplayer.sql` in Supabase SQL Editor. |
| `RPC_MISSING` | `join_private_room` or other RPC missing in Supabase schema cache. | Run `supabase/migrations/001_multiplayer.sql` in Supabase SQL Editor. |
| `ROOM_NOT_FOUND` | Room code does not exist or lobby has closed. | Verify 6-character code with host. |
| `ROOM_FULL` | Room has reached maximum capacity. | Ask host to start a match with higher player count or create a new room. |
| `GAME_IN_PROGRESS` | Battle has already started. | Wait for the round to finish or create a new room. |
| `PERMISSION_DENIED` | Row Level Security (RLS) rejected the request. | Verify table and RPC grants for `anon` role in migration script. |
| `NETWORK_ERROR` | Network timeout or could not reach Supabase servers. | Check internet connection or verify Supabase project is active (not paused). |

---

## 5. Development Mode Fallback

In development mode (`!isProduction`), if both environment variables are absent, Peeranki falls back to local in-memory rooms and `BroadcastChannel` for same-browser testing across multiple tabs.

In production builds (`isProduction = true`), the game strictly requires the configured Supabase backend and will **never** silently fall back to browser-only storage.
