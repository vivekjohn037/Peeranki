/**
 * Small-room walkie-talkie voice chat.
 *
 * Audio stays muted until a player holds the talk control. Supabase Realtime is
 * used only for WebRTC signaling; audio itself travels directly between the
 * players. The mesh is intentionally limited to Peeranki's small rooms.
 */

export interface VoicePeerState {
  sessionId: string;
  playerName: string;
  isSpeaking: boolean;
  isMutedLocally: boolean;
  volume: number;
  connectionState: RTCPeerConnectionState | 'new';
  audioLevel: number;
}

export type VoiceMode = 'push_to_talk';

export interface VoiceChatOptions {
  roomCode: string;
  localSessionId: string;
  localPlayerName: string;
  signalingSend: (event: string, payload: unknown) => Promise<void>;
  onPeersChange?: (peers: Map<string, VoicePeerState>) => void;
  onLocalAudioLevel?: (level: number) => void;
  onStatusChange?: (status: { active: boolean; error?: string; isMicOn: boolean; mode: VoiceMode }) => void;
}

interface VoiceSignal {
  targetSessionId: string;
  senderSessionId: string;
  senderName: string;
  type: 'offer' | 'answer' | 'ice-candidate' | 'voice-presence' | 'voice-speaking' | 'voice-bye';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  isSpeaking?: boolean;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class VoiceChatService {
  private readonly localSessionId: string;
  private readonly localPlayerName: string;
  private readonly signalingSend: VoiceChatOptions['signalingSend'];
  private readonly onPeersChange?: VoiceChatOptions['onPeersChange'];
  private readonly onStatusChange?: VoiceChatOptions['onStatusChange'];

  private localStream: MediaStream | null = null;
  private readonly connections = new Map<string, RTCPeerConnection>();
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly peerStates = new Map<string, VoicePeerState>();
  private readonly pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly offersInProgress = new Set<string>();
  private presenceTimer: number | null = null;
  private isJoined = false;
  private isStarting = false;
  private isTalking = false;
  private isOutputMuted = false;
  private lastErrorMessage = '';

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyV' || event.repeat || this.isTypingTarget(event.target)) return;
    this.setPushToTalkState(true);
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'KeyV') this.setPushToTalkState(false);
  };

  private readonly onWindowBlur = () => this.setPushToTalkState(false);

  constructor(options: VoiceChatOptions) {
    this.localSessionId = options.localSessionId;
    this.localPlayerName = options.localPlayerName;
    this.signalingSend = options.signalingSend;
    this.onPeersChange = options.onPeersChange;
    this.onStatusChange = options.onStatusChange;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return Boolean(el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? ''));
  }

  /** Called only from an explicit Join Voice button press. */
  public async startVoice(): Promise<boolean> {
    if (this.isJoined) return true;
    if (this.isStarting) return false;
    this.isStarting = true;
    this.lastErrorMessage = '';
    this.notifyStatus();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is unavailable. Open Peeranki in a secure browser page.');
      }
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        track.onended = () => {
          this.isTalking = false;
          this.lastErrorMessage = 'Microphone stopped. Rejoin voice to try again.';
          this.notifyStatus();
        };
      });

      this.isJoined = true;
      this.isTalking = false;
      this.lastErrorMessage = '';
      await this.broadcastPresence();
      this.presenceTimer = window.setInterval(() => {
        if (this.isJoined) void this.broadcastPresence();
      }, 8000);
      this.notifyStatus();
      return true;
    } catch (error) {
      const err = error as DOMException;
      this.lastErrorMessage = err?.name === 'NotAllowedError'
        ? 'Microphone permission was blocked. Allow it for this site, then try again.'
        : err?.message || 'Could not start voice chat.';
      this.localStream?.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      this.isJoined = false;
      this.isTalking = false;
      this.notifyStatus();
      return false;
    } finally {
      this.isStarting = false;
      this.notifyStatus();
    }
  }

  public async handleSignalingMessage(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object') return;
    const msg = payload as VoiceSignal;
    if (!msg.senderSessionId || msg.senderSessionId === this.localSessionId) return;
    if (msg.targetSessionId && msg.targetSessionId !== 'all' && msg.targetSessionId !== this.localSessionId) return;

    const peerId = msg.senderSessionId;
    const peerName = msg.senderName || 'Player';
    switch (msg.type) {
      case 'voice-presence': {
        this.ensurePeer(peerId, peerName);
        if (this.isJoined && this.localSessionId > peerId) void this.createOffer(peerId, peerName);
        this.notifyPeers();
        break;
      }
      case 'voice-speaking': {
        const peer = this.ensurePeer(peerId, peerName);
        peer.isSpeaking = Boolean(msg.isSpeaking);
        this.notifyPeers();
        break;
      }
      case 'offer':
        if (this.isJoined && msg.sdp) await this.handleOffer(peerId, peerName, msg.sdp);
        break;
      case 'answer':
        if (msg.sdp) await this.handleAnswer(peerId, msg.sdp);
        break;
      case 'ice-candidate':
        if (msg.candidate) await this.handleCandidate(peerId, msg.candidate);
        break;
      case 'voice-bye':
        this.removePeer(peerId);
        break;
    }
  }

  private ensurePeer(sessionId: string, name: string): VoicePeerState {
    let peer = this.peerStates.get(sessionId);
    if (!peer) {
      peer = {
        sessionId,
        playerName: name,
        isSpeaking: false,
        isMutedLocally: false,
        volume: 1,
        connectionState: 'new',
        audioLevel: 0,
      };
      this.peerStates.set(sessionId, peer);
    } else if (name && peer.playerName !== name) {
      peer.playerName = name;
    }
    return peer;
  }

  private createPeerConnection(sessionId: string, playerName: string): RTCPeerConnection {
    const existing = this.connections.get(sessionId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.connections.set(sessionId, pc);
    this.ensurePeer(sessionId, playerName);
    this.localStream?.getAudioTracks().forEach((track) => pc.addTrack(track, this.localStream!));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) void this.sendSignal({
        type: 'ice-candidate',
        targetSessionId: sessionId,
        candidate: candidate.toJSON(),
      });
    };
    pc.onconnectionstatechange = () => {
      const peer = this.peerStates.get(sessionId);
      if (peer) {
        peer.connectionState = pc.connectionState;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') peer.isSpeaking = false;
        this.notifyPeers();
      }
    };
    pc.ontrack = (event) => {
      const audio = this.audioElements.get(sessionId) ?? new Audio();
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.volume = this.peerStates.get(sessionId)?.volume ?? 1;
      audio.muted = this.isOutputMuted || Boolean(this.peerStates.get(sessionId)?.isMutedLocally);
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      this.audioElements.set(sessionId, audio);
      void audio.play().catch(() => {
        this.lastErrorMessage = 'Tap the page once to enable voice audio.';
        this.notifyStatus();
      });
    };
    return pc;
  }

  private async createOffer(sessionId: string, playerName: string): Promise<void> {
    if (!this.isJoined || this.offersInProgress.has(sessionId)) return;
    this.offersInProgress.add(sessionId);
    try {
      const pc = this.createPeerConnection(sessionId, playerName);
      if (pc.signalingState !== 'stable') return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.sendSignal({ type: 'offer', targetSessionId: sessionId, sdp: offer });
    } catch (error) {
      console.warn('[Peeranki Voice] Could not start peer connection:', error);
    } finally {
      this.offersInProgress.delete(sessionId);
    }
  }

  private async handleOffer(sessionId: string, playerName: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      const pc = this.createPeerConnection(sessionId, playerName);
      if (pc.signalingState !== 'stable') return;
      await pc.setRemoteDescription(sdp);
      await this.flushCandidates(sessionId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.sendSignal({ type: 'answer', targetSessionId: sessionId, sdp: answer });
    } catch (error) {
      console.warn('[Peeranki Voice] Could not answer peer connection:', error);
    }
  }

  private async handleAnswer(sessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.connections.get(sessionId);
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription(sdp);
      await this.flushCandidates(sessionId, pc);
    } catch (error) {
      console.warn('[Peeranki Voice] Could not finish peer connection:', error);
    }
  }

  private async handleCandidate(sessionId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.connections.get(sessionId);
    if (!pc?.remoteDescription) {
      const queue = this.pendingCandidates.get(sessionId) ?? [];
      queue.push(candidate);
      this.pendingCandidates.set(sessionId, queue);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn('[Peeranki Voice] Could not add network candidate:', error);
    }
  }

  private async flushCandidates(sessionId: string, pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingCandidates.get(sessionId) ?? [];
    this.pendingCandidates.delete(sessionId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* Ignore stale candidates. */ }
    }
  }

  private async sendSignal(data: Partial<VoiceSignal>): Promise<void> {
    const payload: VoiceSignal = {
      targetSessionId: data.targetSessionId ?? 'all',
      senderSessionId: this.localSessionId,
      senderName: this.localPlayerName,
      type: data.type ?? 'voice-presence',
      sdp: data.sdp,
      candidate: data.candidate,
      isSpeaking: data.isSpeaking,
    };
    try {
      await this.signalingSend('voice_signal', payload);
    } catch (error) {
      console.warn('[Peeranki Voice] Could not send voice signal:', error);
    }
  }

  private async broadcastPresence(): Promise<void> {
    await this.sendSignal({ type: 'voice-presence', targetSessionId: 'all' });
  }

  private removePeer(sessionId: string): void {
    this.connections.get(sessionId)?.close();
    this.connections.delete(sessionId);
    const audio = this.audioElements.get(sessionId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      this.audioElements.delete(sessionId);
    }
    this.pendingCandidates.delete(sessionId);
    this.peerStates.delete(sessionId);
    this.notifyPeers();
  }

  private notifyPeers(): void {
    this.onPeersChange?.(new Map(this.peerStates));
  }

  private notifyStatus(): void {
    this.onStatusChange?.({
      active: this.isJoined,
      error: this.lastErrorMessage,
      isMicOn: this.isTalking,
      mode: 'push_to_talk',
    });
  }

  public setPushToTalkState(pressed: boolean): void {
    const next = this.isJoined && pressed;
    if (next === this.isTalking) return;
    this.isTalking = next;
    this.localStream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    this.notifyStatus();
    void this.sendSignal({ type: 'voice-speaking', targetSessionId: 'all', isSpeaking: next });
  }

  public isPttPressed(): boolean { return this.isTalking; }
  public getPeerStates(): Map<string, VoicePeerState> { return new Map(this.peerStates); }
  public isVoiceActive(): boolean { return this.isJoined; }
  public isVoiceStarting(): boolean { return this.isStarting; }
  public isMuted(): boolean { return !this.isTalking; }
  public getVoiceMode(): VoiceMode { return 'push_to_talk'; }
  public getLastError(): string { return this.lastErrorMessage; }
  public isOutputAudioMuted(): boolean { return this.isOutputMuted; }

  public toggleOutputAudio(): boolean {
    this.isOutputMuted = !this.isOutputMuted;
    this.audioElements.forEach((audio) => { audio.muted = this.isOutputMuted; });
    return this.isOutputMuted;
  }

  public setPeerMuted(sessionId: string, muted: boolean): void {
    const peer = this.peerStates.get(sessionId);
    const audio = this.audioElements.get(sessionId);
    if (peer && audio) {
      peer.isMutedLocally = muted;
      audio.muted = muted;
      this.notifyPeers();
    }
  }

  public setPeerVolume(sessionId: string, volume: number): void {
    const peer = this.peerStates.get(sessionId);
    const audio = this.audioElements.get(sessionId);
    if (peer && audio) {
      peer.volume = Math.max(0, Math.min(1, volume));
      audio.volume = peer.volume;
    }
  }

  public leaveVoice(): void {
    this.setPushToTalkState(false);
    if (this.presenceTimer !== null) {
      window.clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.isJoined) void this.sendSignal({ type: 'voice-bye', targetSessionId: 'all' });
    this.connections.forEach((pc) => pc.close());
    this.connections.clear();
    this.audioElements.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });
    this.audioElements.clear();
    this.pendingCandidates.clear();
    this.offersInProgress.clear();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.peerStates.clear();
    this.isTalking = false;
    this.isJoined = false;
    this.notifyStatus();
    this.notifyPeers();
  }

  public cleanup(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.leaveVoice();
  }
}
