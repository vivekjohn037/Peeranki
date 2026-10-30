# Online voice chat

Deployment status (31 October 2026): Metered TURN is enabled on the no-card Free Trial Global 500 MB/month plan. No paid plan, card, automatic billing, or Cloudflare Realtime subscription was activated. At quota exhaustion, relay service stops rather than charging overages. The existing v1.1 APK uses this endpoint without rebuilding.

Open Chat and choose Join voice. Microphone access is requested only after Join.
Mute mic stops sending audio while remaining connected; Mute speakers silences incoming audio.
Leave voice, leaving a match, losing signalling, or backgrounding the game releases microphone tracks and closes peer connections.
Audio uses WebRTC (directly or through a configured TURN relay) and is not recorded or stored by the game. Supabase carries only ephemeral signalling.

The app requests ICE credentials from https://peeranki.peerankikerala.workers.dev/api/voice/ice when joining. The endpoint supports Metered (no-card free tier) and Cloudflare. Provider settings are encrypted Worker secrets, with TURN_PROVIDER=metered and TURN_ENABLED=1. When unavailable, the app uses Google's public STUN server and clearly reports direct-only voice. Some restricted networks will not connect without TURN.

No-card setup: Metered

Metered advertises 500 MB of monthly TURN traffic (ingress + egress) without a credit card: https://www.metered.ca/pricing . Use only the Free plan; do not add a card or activate a paid subscription. This is a small allowance for initial use, not unlimited production traffic.

Create the account and TURN credential in the Metered dashboard, then add the following encrypted Secrets to Cloudflare Worker peeranki (Settings > Variables and Secrets):
- TURN_PROVIDER=metered
- METERED_APP_DOMAIN: the app hostname, such as peeranki.metered.live (hostname only).
- METERED_TURN_API_KEY: the existing TURN credential's API key. Do not use or expose an account-wide administrative secret.
- SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY: existing Supabase project values, never the service-role key.
- TURN_ENABLED=1 after the Free plan and credentials have been verified.

The Worker keeps the Metered API key private and fetches the credential's ICE server array only for authenticated connected match members. The actual TURN username/password must reach WebRTC clients; their expiry follows the Metered credential configuration and is not falsely reported as one hour. Configure/rotate credentials in the provider dashboard. The existing APK uses the same endpoint and needs no rebuild to change providers.

Metered API docs: https://www.metered.ca/docs/turn-rest-api/get-credential/

Cloudflare setup (Worker peeranki > Settings > Variables and Secrets): add these as encrypted Secrets so subsequent Wrangler deployments preserve them.
- TURN_KEY_ID and TURN_KEY_API_TOKEN: server-only key from Cloudflare Realtime > TURN. Never add these to VITE variables or the APK.
- SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY: the existing project URL and public publishable key; never use a service-role key.
- TURN_ENABLED=1: activate only after usage/billing review. Omit it to keep all credential issuance disabled.
- Optional VOICE_ALLOWED_ORIGINS: comma-separated extra website origins. Production origin and Capacitor localhost origins are already supported.

The Worker verifies the Supabase access token, checks connected membership in the requested active match, rate-limits requests per authenticated user (5/minute per Cloudflare location), and returns credentials valid for one hour with no-store caching. Rate limiting is approximate and is not a billing cap. Cloudflare's free allowance is not a hard spending limit; do not enable TURN until the account owner has reviewed billing controls. No paid relay subscription or billing has been enabled by the source-code changes.

Cloudflare docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/ and https://developers.cloudflare.com/realtime/turn/faq/

VITE_VOICE_RELAY_URL can override the endpoint. An optional VITE_VOICE_ICE_SERVERS JSON array bypasses dynamic credentials for testing; do not embed permanent provider secrets. The default endpoint allows configuring TURN later without rebuilding an installed APK.

Android declares RECORD_AUDIO and MODIFY_AUDIO_SETTINGS. Capacitor's existing BridgeWebChromeClient requests runtime microphone permission for getUserMedia; no custom permission bypass is used. Installed APKs need a new build.

Verification: automated signalling, negotiation, mute, cancelled-permission and lifecycle tests; browser fixture tests/voice-preview.html connects two real RTCPeerConnection instances with synthetic silent audio and no microphone permission. tests/chat-preview.html previews the real voice/chat UI. Physical Android microphone and cross-network/TURN calls still require device testing.

Live verification: authenticated member of an isolated private match received TURN ICE credentials; authenticated nonmember was rejected with 403; unauthenticated requests returned 401. The private test room was cleaned up. tests/relay-preview.html connected two real WebRTC audio peers using synthetic silent streams, iceTransportPolicy=relay, and selected relay candidate pairs. Temporary ICE configuration was removed after the test.
