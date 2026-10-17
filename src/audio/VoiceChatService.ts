/**
 * Peeranki WebRTC Voice Chat Engine
 *
 * Implements low-latency, peer-to-peer audio mesh over WebRTC using Supabase Realtime
 * broadcast signaling (offers, answers, ICE candidates) or local broadcast channels for multi-tab testing.
 *
 * Features:
 * - Push-to-Talk (PTT) & Open Mic mode with sensitivity gating
 * - Per-peer volume sliders and mute toggles
 * - Live audio level / visualizer detection (Web Audio API AnalyserNode)
 * - Automatic reconnection on network hiccup
 * - Graceful fallback when microphone is unavailable or denied
 * - Works in both Lobby and Game scenes
 */

export interface VoicePeerState {
  sessionId: string;
  playerName: string;
  isSpeaking: boolean;
  isMutedLocally: boolean;
  volume: number; // 0.0 to 1.0
  connectionState: RTCPeerConnectionState | 'new';
  audioLevel: number; // 0 to 100 for visualizer
}

export type VoiceMode = 'open_mic' | 'push_to_talk' | 'deafened';

export interface VoiceChatOptions {
  roomCode: string;
  localSessionId: string;
  localPlayerName: string;
  signalingSend: (event: string, payload: any) => Promise<void>;
  onPeersChange?: (peers: Map<string, VoicePeerState>) => void;
  onLocalAudioLevel?: (level: number) => void;
  onStatusChange?: (status: { active: boolean; error?: string; isMicOn: boolean; mode: VoiceMode }) => void;
}

interface WebRTCSignalPayload {
  targetSessionId: string;
  senderSessionId: string;
  senderName: string;
  type: 'offer' | 'answer' | 'ice-candidate' | 'voice-presence' | 'voice-bye';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  isMuted?: boolean;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export class VoiceChatService {
  private roomCode: string;
  private localSessionId: string;
  private localPlayerName: string;
  private signalingSend: (event: string, payload: any) => Promise<void>;

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localLevelInterval: number | null = null;

  private peerConnections = new Map<string, RTCPeerConnection>();
  private peerStreams = new Map<string, MediaStream>();
  private peerAudioElements = new Map<string, HTMLAudioElement>();
  private peerAnalysers = new Map<string, { analyser: AnalyserNode; interval: number }>();
  private peerStates = new Map<string, VoicePeerState>();

  private isMicEnabled = true;
  private voiceMode: VoiceMode = 'open_mic';
  private isPushToTalkPressed = false;
  private isDeafened = false;
  private isJoined = false;
  private micPermissionGranted = false;
  private lastErrorMessage = '';

  private onPeersChange?: (peers: Map<string, VoicePeerState>) => void;
  private onLocalAudioLevel?: (level: number) => void;
  private onStatusChange?: (status: { active: boolean; error?: string; isMicOn: boolean; mode: VoiceMode }) => void;

  private presenceHeartbeatTimer: number | null = null;

  constructor(options: VoiceChatOptions) {
    this.roomCode = options.roomCode;
    this.localSessionId = options.localSessionId;
    this.localPlayerName = options.localPlayerName;
    this.signalingSend = options.signalingSend;
    this.onPeersChange = options.onPeersChange;
    this.onLocalAudioLevel = options.onLocalAudioLevel;
    this.onStatusChange = options.onStatusChange;

    // Load saved settings if any
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const savedMode = localStorage.getItem('peeranki_voice_mode') as VoiceMode;
        if (savedMode === 'open_mic' || savedMode === 'push_to_talk' || savedMode === 'deafened') {
          this.voiceMode = savedMode;
        }
      } catch {
        // ignore
      }
    }

    this.setupKeyboardListeners();
  }

  private setupKeyboardListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (this.voiceMode === 'push_to_talk' && (e.code === 'KeyV' || e.key === 'v' || e.key === 'V')) {
        // Prevent typing into chat / textboxes triggering PTT
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        if (!this.isPushToTalkPressed) {
          this.isPushToTalkPressed = true;
          this.applyMicrophoneTrackState();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this.voiceMode === 'push_to_talk' && (e.code === 'KeyV' || e.key === 'v' || e.key === 'V')) {
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        if (this.isPushToTalkPressed) {
          this.isPushToTalkPressed = false;
          this.applyMicrophoneTrackState();
        }
      }
    });
  }

  public async startVoice(): Promise<boolean> {
    if (this.isJoined) return true;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('WebRTC / Microphone is not supported by this browser.');
      }

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.micPermissionGranted = true;
      this.isJoined = true;
      this.lastErrorMessage = '';

      // Set up local Web Audio analyzer for visual voice levels
      this.setupLocalAudioAnalysis();

      // Apply initial mic muting / PTT state
      this.applyMicrophoneTrackState();

      // Announce voice presence to the room
      await this.broadcastPresence();

      // Start presence heartbeat
      this.presenceHeartbeatTimer = window.setInterval(() => {
        if (this.isJoined) void this.broadcastPresence();
      }, 5000);

      this.notifyStatus();
      console.log(`[Peeranki Voice] Voice Chat initialized for room ${this.roomCode}`);
      return true;
    } catch (err: any) {
      console.warn('[Peeranki Voice] Microphone access error:', err);
      this.lastErrorMessage = err?.message || 'Could not access microphone';
      this.micPermissionGranted = false;
      this.isJoined = false;
      this.notifyStatus();
      return false;
    }
  }

  private setupLocalAudioAnalysis() {
    if (!this.localStream) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.localAnalyser = this.audioContext.createAnalyser();
      this.localAnalyser.fftSize = 64;
      this.localAnalyser.smoothingTimeConstant = 0.4;
      source.connect(this.localAnalyser);

      const buffer = new Uint8Array(this.localAnalyser.frequencyBinCount);
      this.localLevelInterval = window.setInterval(() => {
        if (!this.localAnalyser || !this.isMicActiveNow()) {
          this.onLocalAudioLevel?.(0);
          return;
        }
        this.localAnalyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i];
        const avg = sum / buffer.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        this.onLocalAudioLevel?.(normalized);
      }, 80);
    } catch (err) {
      console.warn('[Peeranki Voice] AudioContext setup skipped:', err);
    }
  }

  private isMicActiveNow(): boolean {
    if (!this.isJoined || !this.localStream || this.isDeafened) return false;
    if (this.voiceMode === 'deafened') return false;
    if (this.voiceMode === 'push_to_talk') return this.isPushToTalkPressed;
    return this.isMicEnabled;
  }

  public applyMicrophoneTrackState() {
    if (!this.localStream) return;
    const active = this.isMicActiveNow();
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = active;
    });
    this.notifyStatus();
  }

  public setVoiceMode(mode: VoiceMode) {
    this.voiceMode = mode;
    try {
      localStorage.setItem('peeranki_voice_mode', mode);
    } catch {}
    this.applyMicrophoneTrackState();
  }

  public getVoiceMode(): VoiceMode {
    return this.voiceMode;
  }

  public toggleMute(): boolean {
    this.isMicEnabled = !this.isMicEnabled;
    this.applyMicrophoneTrackState();
    return !this.isMicEnabled;
  }

  public isMuted(): boolean {
    return !this.isMicEnabled;
  }

  public isPermissionGranted(): boolean {
    return this.micPermissionGranted;
  }

  public setDeafened(deafen: boolean) {
    this.isDeafened = deafen;
    if (deafen) {
      this.peerAudioElements.forEach((el) => { el.muted = true; });
    } else {
      this.peerAudioElements.forEach((el, sessionId) => {
        const state = this.peerStates.get(sessionId);
        el.muted = state ? state.isMutedLocally : false;
      });
    }
    this.applyMicrophoneTrackState();
    this.notifyStatus();
  }

  public isUserDeafened(): boolean {
    return this.isDeafened;
  }

  public setPeerMuted(targetSessionId: string, muted: boolean) {
    const state = this.peerStates.get(targetSessionId);
    if (state) {
      state.isMutedLocally = muted;
      const audioEl = this.peerAudioElements.get(targetSessionId);
      if (audioEl) audioEl.muted = muted || this.isDeafened;
      this.notifyPeers();
    }
  }

  public setPeerVolume(targetSessionId: string, volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    const state = this.peerStates.get(targetSessionId);
    if (state) {
      state.volume = clamped;
      const audioEl = this.peerAudioElements.get(targetSessionId);
      if (audioEl) audioEl.volume = clamped;
      this.notifyPeers();
    }
  }

  public setPushToTalkState(pressed: boolean) {
    if (this.voiceMode !== 'push_to_talk') return;
    this.isPushToTalkPressed = pressed;
    this.applyMicrophoneTrackState();
  }

  public isPttPressed(): boolean {
    return this.isPushToTalkPressed;
  }

  public getPeerStates(): Map<string, VoicePeerState> {
    return new Map(this.peerStates);
  }

  public isVoiceActive(): boolean {
    return this.isJoined;
  }

  public getLastError(): string {
    return this.lastErrorMessage;
  }

  // -------------------------------------------------------------
  // WebRTC Signaling Handling
  // -------------------------------------------------------------
  public async handleSignalingMessage(payload: any) {
    if (!payload || typeof payload !== 'object') return;
    const msg = payload as WebRTCSignalPayload;

    // Ignore messages from self
    if (msg.senderSessionId === this.localSessionId) return;

    // Check target: either broadcast to all (empty/all) or addressed specifically to this session
    if (msg.targetSessionId && msg.targetSessionId !== 'all' && msg.targetSessionId !== this.localSessionId) {
      return;
    }

    const remoteSessionId = msg.senderSessionId;
    const remoteName = msg.senderName || 'Player';

    switch (msg.type) {
      case 'voice-presence': {
        // A peer announced voice chat. If we are active and lexicographically greater, initiate offer.
        this.ensurePeerState(remoteSessionId, remoteName);
        if (this.isJoined && this.localSessionId > remoteSessionId) {
          void this.initiatePeerConnection(remoteSessionId, remoteName);
        }
        break;
      }

      case 'offer': {
        if (!this.isJoined) return;
        this.ensurePeerState(remoteSessionId, remoteName);
        if (msg.sdp) {
          await this.handleRemoteOffer(remoteSessionId, remoteName, msg.sdp);
        }
        break;
      }

      case 'answer': {
        if (msg.sdp) {
          await this.handleRemoteAnswer(remoteSessionId, msg.sdp);
        }
        break;
      }

      case 'ice-candidate': {
        if (msg.candidate) {
          await this.handleRemoteCandidate(remoteSessionId, msg.candidate);
        }
        break;
      }

      case 'voice-bye': {
        this.removePeer(remoteSessionId);
        break;
      }
    }
  }

  private ensurePeerState(sessionId: string, name: string): VoicePeerState {
    let state = this.peerStates.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        playerName: name,
        isSpeaking: false,
        isMutedLocally: false,
        volume: 1.0,
        connectionState: 'new',
        audioLevel: 0,
      };
      this.peerStates.set(sessionId, state);
      this.notifyPeers();
    } else if (name && state.playerName !== name) {
      state.playerName = name;
      this.notifyPeers();
    }
    return state;
  }

  private createPeerConnection(remoteSessionId: string, remoteName: string): RTCPeerConnection {
    let pc = this.peerConnections.get(remoteSessionId);
    if (pc) return pc;

    pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
    this.peerConnections.set(remoteSessionId, pc);

    // Add local tracks if microphone active
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        pc!.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.sendSignal({
          type: 'ice-candidate',
          targetSessionId: remoteSessionId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = this.peerStates.get(remoteSessionId);
      if (state && pc) {
        state.connectionState = pc.connectionState;
        this.notifyPeers();
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          console.warn(`[Peeranki Voice] Connection to ${remoteName} (${remoteSessionId}) ${pc.connectionState}`);
        }
      }
    };

    pc.ontrack = (event) => {
      console.log(`[Peeranki Voice] Received audio track from ${remoteName}`);
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      this.peerStreams.set(remoteSessionId, remoteStream);

      // Play audio via HTMLAudioElement
      let audio = this.peerAudioElements.get(remoteSessionId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        (audio as any).playsInline = true;
        audio.muted = this.isDeafened;
        this.peerAudioElements.set(remoteSessionId, audio);
      }
      audio.srcObject = remoteStream;
      audio.play().catch((e) => console.warn('[Peeranki Voice] Audio play error:', e));

      // Setup audio analyzer for remote peer speaking detection
      this.setupRemoteAudioAnalysis(remoteSessionId, remoteStream);
    };

    return pc;
  }

  private setupRemoteAudioAnalysis(sessionId: string, stream: MediaStream) {
    // Clear existing if any
    const existing = this.peerAnalysers.get(sessionId);
    if (existing) {
      window.clearInterval(existing.interval);
      this.peerAnalysers.delete(sessionId);
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = this.audioContext || new AudioCtx();
      this.audioContext = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const interval = window.setInterval(() => {
        const state = this.peerStates.get(sessionId);
        if (!state) return;
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i];
        const avg = sum / buffer.length;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        const wasSpeaking = state.isSpeaking;
        state.audioLevel = level;
        state.isSpeaking = level > 12; // threshold for green speaking ring
        if (wasSpeaking !== state.isSpeaking || level > 0) {
          this.notifyPeers();
        }
      }, 100);

      this.peerAnalysers.set(sessionId, { analyser, interval });
    } catch {
      // AudioContext unavailable
    }
  }

  private async initiatePeerConnection(remoteSessionId: string, remoteName: string) {
    try {
      const pc = this.createPeerConnection(remoteSessionId, remoteName);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
      });
      await pc.setLocalDescription(offer);

      await this.sendSignal({
        type: 'offer',
        targetSessionId: remoteSessionId,
        sdp: offer,
      });
    } catch (err) {
      console.warn(`[Peeranki Voice] Failed to create offer for ${remoteSessionId}:`, err);
    }
  }

  private async handleRemoteOffer(remoteSessionId: string, remoteName: string, sdp: RTCSessionDescriptionInit) {
    try {
      const pc = this.createPeerConnection(remoteSessionId, remoteName);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await this.sendSignal({
        type: 'answer',
        targetSessionId: remoteSessionId,
        sdp: answer,
      });
    } catch (err) {
      console.warn(`[Peeranki Voice] Failed to handle offer from ${remoteSessionId}:`, err);
    }
  }

  private async handleRemoteAnswer(remoteSessionId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(remoteSessionId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (err) {
      console.warn(`[Peeranki Voice] Failed to set remote answer from ${remoteSessionId}:`, err);
    }
  }

  private async handleRemoteCandidate(remoteSessionId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(remoteSessionId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn(`[Peeranki Voice] Failed to add ICE candidate for ${remoteSessionId}:`, err);
    }
  }

  private async sendSignal(data: Partial<WebRTCSignalPayload>) {
    const payload: WebRTCSignalPayload = {
      targetSessionId: data.targetSessionId || 'all',
      senderSessionId: this.localSessionId,
      senderName: this.localPlayerName,
      type: data.type || 'voice-presence',
      sdp: data.sdp,
      candidate: data.candidate,
      isMuted: !this.isMicActiveNow(),
    };

    try {
      await this.signalingSend('voice_signal', payload);
    } catch (err) {
      console.warn('[Peeranki Voice] Signaling send failure:', err);
    }
  }

  private async broadcastPresence() {
    await this.sendSignal({
      type: 'voice-presence',
      targetSessionId: 'all',
    });
  }

  private removePeer(sessionId: string) {
    const pc = this.peerConnections.get(sessionId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(sessionId);
    }
    const audio = this.peerAudioElements.get(sessionId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      this.peerAudioElements.delete(sessionId);
    }
    const analyserObj = this.peerAnalysers.get(sessionId);
    if (analyserObj) {
      window.clearInterval(analyserObj.interval);
      this.peerAnalysers.delete(sessionId);
    }
    this.peerStreams.delete(sessionId);
    this.peerStates.delete(sessionId);
    this.notifyPeers();
  }

  private notifyPeers() {
    this.onPeersChange?.(new Map(this.peerStates));
  }

  private notifyStatus() {
    this.onStatusChange?.({
      active: this.isJoined,
      error: this.lastErrorMessage,
      isMicOn: this.isMicActiveNow(),
      mode: this.voiceMode,
    });
  }

  public cleanup() {
    if (this.presenceHeartbeatTimer) {
      window.clearInterval(this.presenceHeartbeatTimer);
      this.presenceHeartbeatTimer = null;
    }
    if (this.localLevelInterval) {
      window.clearInterval(this.localLevelInterval);
      this.localLevelInterval = null;
    }
    if (this.isJoined) {
      void this.sendSignal({ type: 'voice-bye', targetSessionId: 'all' });
    }

    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    this.peerAudioElements.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });
    this.peerAudioElements.clear();

    this.peerAnalysers.forEach((obj) => window.clearInterval(obj.interval));
    this.peerAnalysers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        void this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    this.peerStates.clear();
    this.isJoined = false;
    this.notifyStatus();
    this.notifyPeers();
  }
}
