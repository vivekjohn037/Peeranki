import type { VoiceChatService, VoiceMode } from '../audio/VoiceChatService';
import { addFastTapListener } from './touchUtils';

export class VoiceModalComponent {
  private rootEl: HTMLElement;
  private voiceService: VoiceChatService | null = null;
  private isVisible = false;

  private statusBadgeEl!: HTMLElement;
  private modeSelectEl!: HTMLSelectElement;
  private micToggleBtn!: HTMLButtonElement;
  private deafenToggleBtn!: HTMLButtonElement;
  private pttIndicatorEl!: HTMLElement;
  private localVisualizerFill!: HTMLElement;
  private peerListEl!: HTMLElement;
  private emptyPeersEl!: HTMLElement;

  constructor() {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'pk-modal-backdrop pk-voice-modal-backdrop';
    this.rootEl.style.display = 'none';
    this.initDOM();
  }

  private initDOM() {
    this.rootEl.innerHTML = `
      <div class="pk-modal-dialog pk-voice-dialog" role="dialog" aria-labelledby="pk-voice-title" aria-modal="true">
        <div class="pk-modal-header">
          <div class="pk-modal-title-row">
            <span class="pk-voice-icon-lead">🎙️</span>
            <div>
              <h2 id="pk-voice-title" class="pk-modal-title">VOICE CHAT SETTINGS</h2>
              <div class="pk-voice-subtitle">Live in-game voice audio with room players</div>
            </div>
          </div>
          <button type="button" class="pk-modal-close-btn" aria-label="Close Voice Chat Settings">✕</button>
        </div>

        <div class="pk-voice-dialog-body">
          <!-- Voice Connection Card -->
          <div class="pk-voice-card pk-voice-main-controls">
            <div class="pk-voice-status-row">
              <span class="pk-voice-field-label">Voice Status</span>
              <div class="pk-voice-status-pill">
                <span class="pk-voice-status-dot">🔴</span>
                <span class="pk-voice-status-text">Disconnected</span>
              </div>
            </div>

            <!-- Mode Selector -->
            <div class="pk-voice-field-group">
              <label for="pk-voice-mode-select" class="pk-voice-field-label">Microphone Mode</label>
              <select id="pk-voice-mode-select" class="pk-voice-select">
                <option value="open_mic">🎙️ Open Mic (Voice Activated)</option>
                <option value="push_to_talk">🔘 Push to Talk (Hold 'V' or On-Screen Button)</option>
                <option value="deafened">🔇 Deafened (Mute All & Self)</option>
              </select>
            </div>

            <!-- Action buttons: Mute & Deafen -->
            <div class="pk-voice-btn-row">
              <button type="button" class="pk-voice-btn pk-voice-mic-btn" aria-label="Toggle Microphone">
                <span class="pk-voice-btn-icon">🎙️</span>
                <span class="pk-voice-btn-label">Mic Active</span>
              </button>
              <button type="button" class="pk-voice-btn pk-voice-deafen-btn" aria-label="Toggle Deafen">
                <span class="pk-voice-btn-icon">🎧</span>
                <span class="pk-voice-btn-label">Deafen</span>
              </button>
            </div>

            <!-- Push-To-Talk On-Screen Hold Button -->
            <div class="pk-ptt-hold-container" style="display: none;">
              <button type="button" class="pk-ptt-hold-button" aria-label="Push To Talk Hold Button">
                <span>HOLD TO TALK (OR PRESS 'V')</span>
              </button>
            </div>

            <!-- Local Mic Visualizer -->
            <div class="pk-voice-visualizer-row">
              <span class="pk-voice-field-label">Mic Input Level</span>
              <div class="pk-voice-level-meter">
                <div class="pk-voice-level-fill"></div>
              </div>
            </div>
          </div>

          <!-- Active Peers In Call -->
          <div class="pk-voice-card pk-voice-peers-card">
            <div class="pk-voice-peers-header">
              <span class="pk-voice-field-label">Players in Voice</span>
              <span class="pk-voice-peers-count">0 connected</span>
            </div>
            <div class="pk-voice-peers-list">
              <div class="pk-voice-empty-peers">
                <span>No other players have connected their microphone yet.</span>
                <small>Invite your friends or share room code to talk!</small>
              </div>
            </div>
          </div>
        </div>

        <div class="pk-modal-footer pk-voice-dialog-footer">
          <button type="button" class="pk-modal-action-btn pk-voice-done-btn">DONE</button>
        </div>
      </div>
    `;

    this.statusBadgeEl = this.rootEl.querySelector('.pk-voice-status-pill')!;
    this.modeSelectEl = this.rootEl.querySelector('#pk-voice-mode-select')!;
    this.micToggleBtn = this.rootEl.querySelector('.pk-voice-mic-btn')!;
    this.deafenToggleBtn = this.rootEl.querySelector('.pk-voice-deafen-btn')!;
    this.pttIndicatorEl = this.rootEl.querySelector('.pk-ptt-hold-container')!;
    this.localVisualizerFill = this.rootEl.querySelector('.pk-voice-level-fill')!;
    this.peerListEl = this.rootEl.querySelector('.pk-voice-peers-list')!;
    this.emptyPeersEl = this.rootEl.querySelector('.pk-voice-empty-peers')!;

    const closeBtn = this.rootEl.querySelector('.pk-modal-close-btn')!;
    const doneBtn = this.rootEl.querySelector('.pk-voice-done-btn')!;
    const pttBtn = this.rootEl.querySelector('.pk-ptt-hold-button')!;

    addFastTapListener(closeBtn as HTMLElement, () => this.hide());
    addFastTapListener(doneBtn as HTMLElement, () => this.hide());

    // Backdrop click
    this.rootEl.addEventListener('click', (e) => {
      if (e.target === this.rootEl) this.hide();
    });

    // Mode change
    this.modeSelectEl.addEventListener('change', () => {
      const mode = this.modeSelectEl.value as VoiceMode;
      this.voiceService?.setVoiceMode(mode);
      this.updateView();
    });

    // Toggle Mic
    addFastTapListener(this.micToggleBtn, () => {
      if (this.voiceService) {
        if (!this.voiceService.isVoiceActive()) {
          void this.voiceService.startVoice().then(() => this.updateView());
        } else {
          this.voiceService.toggleMute();
          this.updateView();
        }
      }
    });

    // Toggle Deafen
    addFastTapListener(this.deafenToggleBtn, () => {
      if (this.voiceService) {
        const currentlyDeafened = this.voiceService.isUserDeafened();
        this.voiceService.setDeafened(!currentlyDeafened);
        this.updateView();
      }
    });

    // On-screen PTT touch / pointer hold
    const startPTT = (e: Event) => {
      e.preventDefault();
      pttBtn.classList.add('is-pressed');
      this.voiceService?.setPushToTalkState(true);
    };
    const endPTT = (e: Event) => {
      e.preventDefault();
      pttBtn.classList.remove('is-pressed');
      this.voiceService?.setPushToTalkState(false);
    };

    pttBtn.addEventListener('mousedown', startPTT);
    pttBtn.addEventListener('mouseup', endPTT);
    pttBtn.addEventListener('mouseleave', endPTT);
    pttBtn.addEventListener('touchstart', startPTT, { passive: false });
    pttBtn.addEventListener('touchend', endPTT, { passive: false });
    pttBtn.addEventListener('touchcancel', endPTT, { passive: false });
  }

  public setVoiceService(service: VoiceChatService | null) {
    this.voiceService = service;
    if (this.voiceService) {
      this.modeSelectEl.value = this.voiceService.getVoiceMode();
    }
    this.updateView();
  }

  public getElement(): HTMLElement {
    return this.rootEl;
  }

  public show() {
    this.isVisible = true;
    this.rootEl.style.display = 'flex';
    // Auto start microphone when modal is opened if not active
    if (this.voiceService && !this.voiceService.isVoiceActive()) {
      void this.voiceService.startVoice().then(() => this.updateView());
    }
    this.updateView();
  }

  public hide() {
    this.isVisible = false;
    this.rootEl.style.display = 'none';
  }

  public toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  public updateLocalAudioLevel(level: number) {
    if (!this.isVisible) return;
    this.localVisualizerFill.style.width = `${level}%`;
    if (level > 15) {
      this.localVisualizerFill.style.backgroundColor = '#22c55e';
    } else {
      this.localVisualizerFill.style.backgroundColor = '#38bdf8';
    }
  }

  public updateView() {
    if (!this.voiceService) {
      this.statusBadgeEl.innerHTML = `<span class="pk-voice-status-dot">🔴</span><span class="pk-voice-status-text">Offline</span>`;
      return;
    }

    const isActive = this.voiceService.isVoiceActive();
    const isMuted = this.voiceService.isMuted();
    const isDeaf = this.voiceService.isUserDeafened();
    const mode = this.voiceService.getVoiceMode();

    // 1. Status Pill
    if (!isActive) {
      const err = this.voiceService.getLastError();
      if (err) {
        this.statusBadgeEl.className = 'pk-voice-status-pill is-error';
        this.statusBadgeEl.innerHTML = `<span class="pk-voice-status-dot">⚠️</span><span class="pk-voice-status-text">Mic Denied</span>`;
        this.statusBadgeEl.title = err;
      } else {
        this.statusBadgeEl.className = 'pk-voice-status-pill is-disconnected';
        this.statusBadgeEl.innerHTML = `<span class="pk-voice-status-dot">🔴</span><span class="pk-voice-status-text">Connecting Mic...</span>`;
      }
    } else if (isDeaf) {
      this.statusBadgeEl.className = 'pk-voice-status-pill is-deafened';
      this.statusBadgeEl.innerHTML = `<span class="pk-voice-status-dot">🎧</span><span class="pk-voice-status-text">Deafened</span>`;
    } else if (isMuted) {
      this.statusBadgeEl.className = 'pk-voice-status-pill is-muted';
      this.statusBadgeEl.innerHTML = `<span class="pk-voice-status-dot">🔇</span><span class="pk-voice-status-text">Muted</span>`;
    } else {
      this.statusBadgeEl.className = 'pk-voice-status-pill is-active';
      this.statusBadgeEl.innerHTML = `<span class="pk-voice-status-dot">🟢</span><span class="pk-voice-status-text">Voice Connected</span>`;
    }

    // 2. Mode Select
    this.modeSelectEl.value = mode;

    // 3. PTT Container
    if (mode === 'push_to_talk') {
      this.pttIndicatorEl.style.display = 'block';
    } else {
      this.pttIndicatorEl.style.display = 'none';
    }

    // 4. Mic & Deafen buttons
    if (isMuted) {
      this.micToggleBtn.className = 'pk-voice-btn pk-voice-mic-btn is-off';
      this.micToggleBtn.innerHTML = `<span class="pk-voice-btn-icon">🔇</span><span class="pk-voice-btn-label">Unmute Mic</span>`;
    } else {
      this.micToggleBtn.className = 'pk-voice-btn pk-voice-mic-btn is-on';
      this.micToggleBtn.innerHTML = `<span class="pk-voice-btn-icon">🎙️</span><span class="pk-voice-btn-label">Mute Mic</span>`;
    }

    if (isDeaf) {
      this.deafenToggleBtn.className = 'pk-voice-btn pk-voice-deafen-btn is-on';
      this.deafenToggleBtn.innerHTML = `<span class="pk-voice-btn-icon">🔇</span><span class="pk-voice-btn-label">Undeafen</span>`;
    } else {
      this.deafenToggleBtn.className = 'pk-voice-btn pk-voice-deafen-btn is-off';
      this.deafenToggleBtn.innerHTML = `<span class="pk-voice-btn-icon">🎧</span><span class="pk-voice-btn-label">Deafen All</span>`;
    }

    // 5. Update Peers List
    this.renderPeers();
  }

  public renderPeers() {
    if (!this.voiceService) return;
    const peers = this.voiceService.getPeerStates();
    const countEl = this.rootEl.querySelector('.pk-voice-peers-count');
    if (countEl) {
      countEl.textContent = `${peers.size} connected`;
    }

    if (peers.size === 0) {
      this.emptyPeersEl.style.display = 'flex';
      // Remove other elements
      Array.from(this.peerListEl.children).forEach((child) => {
        if (child !== this.emptyPeersEl) child.remove();
      });
      return;
    }

    this.emptyPeersEl.style.display = 'none';

    // Synchronize peer items
    peers.forEach((peer, sessionId) => {
      let item = this.peerListEl.querySelector(`[data-peer-id="${sessionId}"]`) as HTMLElement;
      if (!item) {
        item = document.createElement('div');
        item.className = 'pk-voice-peer-item';
        item.dataset.peerId = sessionId;
        item.innerHTML = `
          <div class="pk-voice-peer-info">
            <div class="pk-voice-peer-avatar-wrapper">
              <span class="pk-voice-peer-avatar">👤</span>
              <div class="pk-voice-speaking-ring"></div>
            </div>
            <span class="pk-voice-peer-name">${peer.playerName}</span>
          </div>
          <div class="pk-voice-peer-controls">
            <input type="range" class="pk-voice-peer-vol" min="0" max="100" value="${Math.round(peer.volume * 100)}" aria-label="Peer Volume" />
            <button type="button" class="pk-voice-peer-mute-btn" aria-label="Mute Peer">
              ${peer.isMutedLocally ? '🔇' : '🔊'}
            </button>
          </div>
        `;

        const volSlider = item.querySelector<HTMLInputElement>('.pk-voice-peer-vol')!;
        const muteBtn = item.querySelector<HTMLButtonElement>('.pk-voice-peer-mute-btn')!;

        volSlider.addEventListener('input', () => {
          const vol = Number(volSlider.value) / 100;
          this.voiceService?.setPeerVolume(sessionId, vol);
        });

        addFastTapListener(muteBtn, () => {
          const curr = this.voiceService?.getPeerStates().get(sessionId);
          if (curr) {
            this.voiceService?.setPeerMuted(sessionId, !curr.isMutedLocally);
            muteBtn.textContent = !curr.isMutedLocally ? '🔇' : '🔊';
          }
        });

        this.peerListEl.appendChild(item);
      }

      // Update peer item status
      const nameEl = item.querySelector('.pk-voice-peer-name');
      if (nameEl) nameEl.textContent = peer.playerName;

      const muteBtn = item.querySelector('.pk-voice-peer-mute-btn');
      if (muteBtn) muteBtn.textContent = peer.isMutedLocally ? '🔇' : '🔊';

      const ring = item.querySelector('.pk-voice-speaking-ring') as HTMLElement;
      if (ring) {
        if (peer.isSpeaking) {
          ring.classList.add('is-speaking');
        } else {
          ring.classList.remove('is-speaking');
        }
      }
    });

    // Remove any disconnected peers
    Array.from(this.peerListEl.children).forEach((child) => {
      if (child === this.emptyPeersEl) return;
      const id = (child as HTMLElement).dataset.peerId;
      if (id && !peers.has(id)) {
        child.remove();
      }
    });
  }
}
