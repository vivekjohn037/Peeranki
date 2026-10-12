# Deploying Peeranki to Cloudflare Pages

This guide outlines the exact settings, environment variables, and steps to deploy the **Peeranki** frontend to **Cloudflare Pages** (`*.pages.dev`).

---

## 1. Cloudflare Pages Project Configuration

In the [Cloudflare Dashboard](https://dash.cloudflare.com/):

1. Navigate to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. Select your repository (`peeranki`).
3. Set the following build settings:
   - **Project name**: `peeranki` (creates `https://peeranki.pages.dev`)
   - **Production branch**: `main` (or your default branch)
   - **Framework preset**: `Vite` (or None)
   - **Build command**: `bun run build` (or `npm run build`)
   - **Build output directory**: `dist`
   - **Node.js version**: `20` or higher (under **Environment variables**, set `NODE_VERSION` = `20` if prompted)

---

## 2. Direct CLI Deployment Workflow (Wrangler Pages)

If you prefer deploying directly from your terminal rather than Git integration:

1. Authenticate with Cloudflare:
   ```bash
   npx wrangler login
   ```
2. Build the production assets:
   ```bash
   bun run build
   # or
   npm run build
   ```
3. Deploy the `dist` directory to Cloudflare Pages:
   ```bash
   npx wrangler pages deploy dist --project-name=peeranki
   ```

> ⚠️ **Important Deployment Distinction**:
> - **DO NOT USE** `npx wrangler deploy`. That command deploys standard Cloudflare Workers (serverless functions), which requires a `wrangler.toml` file with worker handlers and fails on static web apps.
> - **ALWAYS USE** `npx wrangler pages deploy dist` for Cloudflare Pages static web applications.

## 3. Environment Variables

In **Cloudflare Pages** > **Settings** > **Environment variables**, configure the variables for **Production** (and **Preview**):

| Variable Name | Required | Value / Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes (for online multiplayer) | Your Supabase project URL (e.g. `https://srygfddukkmrqgdnrbqp.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes (for online multiplayer) | Your Supabase `anon` / publishable key (safe for client builds) |
| `NODE_VERSION` | Recommended | `20` |

> ⚠️ **Important Security Rule**:
> NEVER set `SUPABASE_SERVICE_ROLE_KEY` in Cloudflare Pages frontend environment variables. Only the public `anon`/publishable key (`VITE_SUPABASE_PUBLISHABLE_KEY`) should be used on the client.

---

## 4. Multiplayer Architecture & Backend

- **Backend Type**: Supabase (PostgreSQL database + Realtime WebSockets).
- **Backend Independence**: The multiplayer backend runs on Supabase's global cloud infrastructure (`*.supabase.co`), completely separate from Cloudflare Pages static hosting.
- **Connection Protocol**: The browser connects directly to Supabase via secure HTTPS REST RPC calls (`/rest/v1/rpc/...`) and secure WebSockets (`wss://.../realtime/v1/websocket`).
- **No Node.js Server Needed**: You do **not** need a separate Node.js server or Cloudflare Workers/Durable Objects for game lobbies and matches. The existing Supabase tables and RPCs handle room matchmaking, touch heartbeats, stale player cleanup, and real-time state broadcasts.

---

## 5. SPA Routing, Headers, and Asset Limits

- **Asset Limits**: Cloudflare Pages enforces a strict maximum of 25 MiB per individual static asset. Background music is compressed in 192 kbps MP3 format (~3.5 MiB), and Vite includes a guard plugin (`cloudflareAssetGuardPlugin`) that verifies all output files in `dist/` remain strictly below 25 MiB.
- `_redirects`: Contains `/* /index.html 200` to ensure deep links and page refreshes route smoothly without 404 errors.
- `_headers`: Applies optimal cache control (`max-age=31536000` on immutable static assets) and security headers.
