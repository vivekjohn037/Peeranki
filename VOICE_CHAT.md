# Online voice chat

Open Chat and choose Join voice. Microphone access is requested only after Join.
Mute mic stops sending audio while remaining connected; Mute speakers silences incoming audio.
Leave voice, leaving a match, losing signalling, or backgrounding the game releases microphone tracks and closes peer connections.
Audio is sent peer-to-peer with WebRTC and is not recorded or stored by the game. Supabase carries only ephemeral signalling.

The default ICE configuration uses Google's public STUN server. No TURN relay is configured, so some mobile, corporate, or restrictive NAT networks cannot connect. The UI reports this instead of claiming voice is connected.
To support these networks, set VITE_VOICE_ICE_SERVERS to a JSON array of RTCIceServer entries supplied by your relay provider and rebuild. Client configuration is public; never include provider API/service secrets. Production TURN credentials should be short-lived and obtained from an authenticated server endpoint when integrating a provider.

Android declares RECORD_AUDIO and MODIFY_AUDIO_SETTINGS. Capacitor's existing BridgeWebChromeClient requests runtime microphone permission for getUserMedia; no custom permission bypass is used. Installed APKs need a new build.

Verification: automated signalling, negotiation, mute, cancelled-permission and lifecycle tests; browser fixture tests/voice-preview.html connects two real RTCPeerConnection instances with synthetic silent audio and no microphone permission. tests/chat-preview.html previews the real voice/chat UI. Physical Android microphone and cross-network/TURN calls still require device testing.
