import type { VoiceChatService, VoicePeerState } from '../audio/VoiceChatService';
import { addFastTapListener } from './touchUtils';

/** A compact, opt-in walkie-talkie panel for the current online room. */
export class VoiceModalComponent {
  private readonly rootEl: HTMLElement;
  private voiceService: VoiceChatService | null = null;
  private isVisible = false;
  private statusEl!: HTMLElement;
  private joinButton!: HTMLButtonElement;
  private leaveButton!: HTMLButtonElement;
  private talkButton!: HTMLButtonElement;
  private errorEl!: HTMLElement;
  private peersEl!: HTMLElement;

  constructor() {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'pk-modal-backdrop pk-voice-modal-backdrop';
    this.rootEl.style.display = 'none';
    this.initDOM();
  }

  private initDOM(): void {
    this.rootEl.innerHTML = `
      <section class="pk-modal-dialog pk-voice-dialog pk-walkie-dialog" role="dialog" aria-labelledby="pk-voice-title" aria-modal="true">
        <header class="pk-modal-header">
          <div class="pk-modal-title-row">
            <span class="pk-voice-icon-lead" aria-hidden="true">📻</span>
            <div>
              <h2 id="pk-voice-title" class="pk-modal-title">ROOM WALKIE-TALKIE</h2>
              <p class="pk-voice-subtitle">Join by choice. Hold to talk; release to mute.</p>
            </div>
          </div>
          <button type="button" class="pk-modal-close-btn" aria-label="Close voice panel">✕</button>
        </header>
        <div class="pk-voice-dialog-body">
          <div class="pk-voice-card pk-walkie-controls">
            <div class="pk-voice-status-row">
              <span class="pk-voice-field-label">Room voice</span>
              <span class="pk-voice-status-pill is-disconnected" role="status">Not connected</span>
            </div>
            <div class="pk-walkie-actions">
              <button type="button" class="pk-voice-btn pk-walkie-join">Join voice</button>
              <button type="button" class="pk-voice-btn pk-walkie-leave" hidden>Leave voice</button>
            </div>
            <button type="button" class="pk-ptt-hold-button pk-walkie-talk" disabled aria-label="Hold to talk">
              <span class="pk-walkie-talk-icon" aria-hidden="true">🎙️</span>
              <span>HOLD TO TALK</span>
              <small>or hold V on keyboard</small>
            </button>
            <p class="pk-walkie-error" role="alert" hidden></p>
          </div>
          <div class="pk-voice-card pk-walkie-roster">
            <div class="pk-voice-peers-header">
              <span class="pk-voice-field-label">Players connected to voice</span>
              <span class="pk-voice-peers-count">0</span>
            </div>
            <ul class="pk-voice-peers-list" aria-live="polite"></ul>
            <p class="pk-voice-empty-peers">You’re alone in voice for now. Friends can join from this room.</p>
          </div>
        </div>
        <footer class="pk-modal-footer pk-voice-dialog-footer">
          <button type="button" class="pk-modal-action-btn pk-voice-done-btn">DONE</button>
        </footer>
      </section>
    `;

    this.statusEl = this.rootEl.querySelector('.pk-voice-status-pill')!;
    this.joinButton = this.rootEl.querySelector('.pk-walkie-join')!;
    this.leaveButton = this.rootEl.querySelector('.pk-walkie-leave')!;
    this.talkButton = this.rootEl.querySelector('.pk-walkie-talk')!;
    this.errorEl = this.rootEl.querySelector('.pk-walkie-error')!;
    this.peersEl = this.rootEl.querySelector('.pk-voice-peers-list')!;

    const hide = () => this.hide();
    addFastTapListener(this.rootEl.querySelector('.pk-modal-close-btn') as HTMLElement, hide);
    addFastTapListener(this.rootEl.querySelector('.pk-voice-done-btn') as HTMLElement, hide);
    this.rootEl.addEventListener('click', (event) => {
      if (event.target === this.rootEl) hide();
    });

    addFastTapListener(this.joinButton, () => {
      this.errorEl.hidden = true;
      void this.voiceService?.startVoice().then((joined) => {
        if (!joined && this.voiceService) {
          this.errorEl.textContent = this.voiceService.getLastError();
          this.errorEl.hidden = !this.errorEl.textContent;
        }
        this.updateView();
      });
    });
    addFastTapListener(this.leaveButton, () => {
      this.voiceService?.leaveVoice();
      this.updateView();
    });

    const startTalk = (event: PointerEvent) => {
      if (!this.voiceService?.isVoiceActive()) return;
      event.preventDefault();
      this.talkButton.classList.add('is-pressed');
      try { this.talkButton.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable. */ }
      this.voiceService.setPushToTalkState(true);
      this.updateView();
    };
    const stopTalk = (event: PointerEvent) => {
      event.preventDefault();
      this.talkButton.classList.remove('is-pressed');
      this.voiceService?.setPushToTalkState(false);
      this.updateView();
    };
    this.talkButton.addEventListener('pointerdown', startTalk);
    this.talkButton.addEventListener('pointerup', stopTalk);
    this.talkButton.addEventListener('pointercancel', stopTalk);
    this.talkButton.addEventListener('lostpointercapture', stopTalk);
    this.talkButton.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  public setVoiceService(service: VoiceChatService | null): void {
    this.voiceService = service;
    this.updateView();
  }

  public getElement(): HTMLElement { return this.rootEl; }

  public show(): void {
    this.isVisible = true;
    this.rootEl.style.display = 'flex';
    this.updateView();
  }

  public hide(): void {
    this.isVisible = false;
    this.rootEl.style.display = 'none';
    this.voiceService?.setPushToTalkState(false);
  }

  public toggle(): void {
    if (this.isVisible) this.hide();
    else this.show();
  }

  public updateLocalAudioLevel(_level: number): void {
    // Kept as a compatibility no-op for the existing game UI callback.
  }

  public updateView(): void {
    const joined = Boolean(this.voiceService?.isVoiceActive());
    const starting = Boolean(this.voiceService?.isVoiceStarting());
    const talking = Boolean(this.voiceService?.isPttPressed());
    this.statusEl.className = `pk-voice-status-pill ${!joined ? 'is-disconnected' : talking ? 'is-active' : 'is-muted'}`;
    this.statusEl.textContent = starting ? 'Requesting microphone…' : !joined ? 'Not connected' : talking ? 'You’re talking' : 'Connected · mic muted';
    this.joinButton.hidden = joined;
    this.joinButton.disabled = starting;
    this.joinButton.textContent = starting ? 'Requesting microphone…' : 'Join voice';
    this.leaveButton.hidden = !joined;
    this.talkButton.disabled = !joined;
    this.talkButton.classList.toggle('is-pressed', talking);
    if (joined) {
      this.errorEl.hidden = true;
    } else if (this.voiceService?.getLastError()) {
      this.errorEl.textContent = this.voiceService.getLastError();
      this.errorEl.hidden = false;
    }
    this.renderPeers();
  }

  public renderPeers(): void {
    const peers = this.voiceService?.getPeerStates() ?? new Map<string, VoicePeerState>();
    const countEl = this.rootEl.querySelector('.pk-voice-peers-count');
    const emptyEl = this.rootEl.querySelector('.pk-voice-empty-peers') as HTMLElement | null;
    if (countEl) countEl.textContent = String(peers.size);
    if (emptyEl) emptyEl.hidden = peers.size > 0;
    this.peersEl.replaceChildren();

    peers.forEach((peer) => {
      const row = document.createElement('li');
      row.className = 'pk-walkie-peer';
      const name = document.createElement('span');
      name.className = 'pk-walkie-peer-name';
      name.textContent = peer.playerName;
      const state = document.createElement('span');
      state.className = 'pk-walkie-peer-state';
      const connected = peer.connectionState === 'connected';
      state.textContent = peer.isSpeaking ? 'Speaking' : connected ? 'Listening' : 'Connecting';
      state.classList.toggle('is-speaking', peer.isSpeaking);
      row.append(name, state);
      this.peersEl.appendChild(row);
    });
  }
}
