import type { HUDState, UICallbacks, WeaponType } from './types';
import { showHowToPlayModal } from './HowToPlayModalComponent';
import { addFastTapListener } from './touchUtils';

const WEAPON_INFO: Record<WeaponType, { label: string; icon: string; desc: string }> = {
  gun: { label: 'Gun', icon: 'assets/weapons/gun.png', desc: 'Standard single shot' },
  peeranki: { label: 'Peeranki', icon: 'assets/weapons/peeranki.png', desc: 'Heavy cannon shot' },
  shield: { label: 'Shield', icon: 'assets/weapons/shield.png', desc: 'Passive protection' },
  hook: { label: 'Hook', icon: 'assets/weapons/hook.png', desc: 'Disables opponent shield' },
  doublePeeranki: { label: 'Double Peeranki', icon: 'assets/weapons/double_peeranki.png', desc: 'Fires at two opponents' },
};

export class HUDComponent {
  private callbacks: UICallbacks;
  private topbarEl!: HTMLElement;
  private announcerEl!: HTMLElement;
  private countdownEl!: HTMLElement;
  private bottombarEl!: HTMLElement;

  private timerValEl!: HTMLElement;
  private roundValEl!: HTMLElement;
  private audioBtnEl!: HTMLButtonElement;
  private netBadgeEl!: HTMLButtonElement;
  private toastContainer!: HTMLElement;
  private currentRoomCode: string | null = null;
  private announcerTextEl!: HTMLElement;
  private promptTextEl!: HTMLElement;
  private promptSubtextEl!: HTMLElement;
  private weaponChipsContainer!: HTMLElement;
  private countdownNumEl!: HTMLElement;
  private countdownSubEl!: HTMLElement;

  constructor(callbacks: UICallbacks) {
    this.callbacks = callbacks;
    this.initElements();
  }

  private initElements() {
    // 1. Topbar
    this.topbarEl = document.createElement('header');
    this.topbarEl.className = 'pk-hud-topbar';
    this.topbarEl.innerHTML = `
      <div class="pk-topbar-brand">
        <img class="pk-topbar-logo" src="assets/peeranki-logo.webp" alt="Peeranki Logo" />
        <span class="pk-topbar-title">PEERANKI</span>
      </div>
      <div class="pk-topbar-meta">
        <button type="button" class="pk-net-status-badge" aria-label="Multiplayer Network Status">
          <span class="pk-net-dot">🟢</span>
          <span class="pk-net-label">SYNCED</span>
        </button>
        <div class="pk-match-timer-badge">
          <span aria-hidden="true">⏱️</span>
          <span class="pk-timer-display">05:00</span>
        </div>
        <span class="pk-match-round-text">ROUND 1</span>
      </div>
      <div class="pk-topbar-actions">
        <button type="button" class="pk-btn-icon pk-btn-fullscreen" aria-label="Toggle Fullscreen" title="Toggle Fullscreen">
          ⛶
        </button>
        <button type="button" class="pk-btn-icon pk-btn-help" aria-label="How to Play Guide" title="How to Play Guide">
          ❓
        </button>
        <button type="button" class="pk-btn-icon pk-audio-btn" aria-label="Mute Background Music" title="Mute Background Music">
          🔊
        </button>
        <button type="button" class="pk-btn-leave" aria-label="Leave Game">
          LEAVE
        </button>
      </div>
    `;

    this.timerValEl = this.topbarEl.querySelector('.pk-timer-display')!;
    this.roundValEl = this.topbarEl.querySelector('.pk-match-round-text')!;
    this.audioBtnEl = this.topbarEl.querySelector('.pk-audio-btn')!;
    this.netBadgeEl = this.topbarEl.querySelector<HTMLButtonElement>('.pk-net-status-badge')!;

    this.toastContainer = document.createElement('div');
    this.toastContainer.className = 'pk-hud-toast-container';
    this.topbarEl.appendChild(this.toastContainer);

    addFastTapListener(this.netBadgeEl, async () => {
      if (this.currentRoomCode) {
        try {
          await navigator.clipboard.writeText(this.currentRoomCode);
          this.showToast(`📋 Room Code ${this.currentRoomCode} copied!`, 'success');
        } catch {
          this.showToast(`Room: ${this.currentRoomCode}`, 'info');
        }
      }
    });
    const fullscreenBtn = this.topbarEl.querySelector<HTMLButtonElement>('.pk-btn-fullscreen');
    const helpBtn = this.topbarEl.querySelector<HTMLButtonElement>('.pk-btn-help');
    const leaveBtn = this.topbarEl.querySelector<HTMLButtonElement>('.pk-btn-leave')!;

    if (fullscreenBtn) {
      const updateFsIcon = () => {
        const isFs = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
        fullscreenBtn.textContent = isFs ? '✕' : '⛶';
        fullscreenBtn.title = isFs ? 'Exit Fullscreen' : 'Enter Fullscreen';
      };

      addFastTapListener(fullscreenBtn, () => {
        try {
          if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
            if (document.documentElement.requestFullscreen) {
              void document.documentElement.requestFullscreen().catch(() => undefined);
            } else if ((document.documentElement as any).webkitRequestFullscreen) {
              (document.documentElement as any).webkitRequestFullscreen();
            }
          } else {
            if (document.exitFullscreen) {
              void document.exitFullscreen().catch(() => undefined);
            } else if ((document as any).webkitExitFullscreen) {
              (document as any).webkitExitFullscreen();
            }
          }
        } catch {
          // ignore
        }
      });

      document.addEventListener('fullscreenchange', updateFsIcon);
      document.addEventListener('webkitfullscreenchange', updateFsIcon);
    }

    if (helpBtn) {
      addFastTapListener(helpBtn, () => {
        showHowToPlayModal();
      });
    }

    // Initialize initial mute state from global storage
    try {
      const isInitiallyMuted = localStorage.getItem('peeranki_music_muted') === 'true';
      this.updateAudioButtonState(isInitiallyMuted);
    } catch {
      // ignore
    }

    addFastTapListener(this.audioBtnEl, () => {
      const isMuted = this.callbacks.onToggleAudio();
      this.updateAudioButtonState(isMuted);
    });

    addFastTapListener(leaveBtn, () => {
      this.callbacks.onLeaveGame();
    });

    // 2. Announcer Banner
    this.announcerEl = document.createElement('div');
    this.announcerEl.className = 'pk-announcer-banner';
    this.announcerTextEl = document.createElement('span');
    this.announcerEl.appendChild(this.announcerTextEl);

    // 3. Countdown Overlay
    this.countdownEl = document.createElement('div');
    this.countdownEl.className = 'pk-countdown-banner';
    this.countdownEl.style.display = 'none';
    this.countdownEl.innerHTML = `
      <div class="pk-countdown-num">1</div>
      <div class="pk-countdown-sub">COUNTING...</div>
    `;
    this.countdownNumEl = this.countdownEl.querySelector('.pk-countdown-num')!;
    this.countdownSubEl = this.countdownEl.querySelector('.pk-countdown-sub')!;

    // 4. Bottom Action HUD
    this.bottombarEl = document.createElement('footer');
    this.bottombarEl.className = 'pk-hud-bottombar';
    this.bottombarEl.innerHTML = `
      <div class="pk-action-prompt-row">
        <div class="pk-action-prompt-text">
          <span class="pk-prompt-main">Preparing round...</span>
        </div>
        <div class="pk-action-prompt-subtext"></div>
      </div>
      <div class="pk-weapon-selector-dock">
        <button type="button" class="pk-weapon-cycle-btn pk-cycle-prev" aria-label="Previous Weapon">‹</button>
        <div class="pk-weapon-chip-list"></div>
        <button type="button" class="pk-weapon-cycle-btn pk-cycle-next" aria-label="Next Weapon">›</button>
      </div>
      <div class="pk-keyboard-hint">Keyboard: press numbers 1–9 to target a player</div>
    `;

    this.promptTextEl = this.bottombarEl.querySelector('.pk-prompt-main')!;
    this.promptSubtextEl = this.bottombarEl.querySelector('.pk-action-prompt-subtext')!;
    this.weaponChipsContainer = this.bottombarEl.querySelector('.pk-weapon-chip-list')!;

    const prevBtn = this.bottombarEl.querySelector('.pk-cycle-prev')!;
    const nextBtn = this.bottombarEl.querySelector('.pk-cycle-next')!;

    addFastTapListener(prevBtn as HTMLElement, () => this.callbacks.onCycleWeapon(-1));
    addFastTapListener(nextBtn as HTMLElement, () => this.callbacks.onCycleWeapon(1));
  }

  public getTopBar(): HTMLElement {
    return this.topbarEl;
  }

  public getAnnouncer(): HTMLElement {
    return this.announcerEl;
  }

  public getCountdown(): HTMLElement {
    return this.countdownEl;
  }

  public getBottomBar(): HTMLElement {
    return this.bottombarEl;
  }

  public updateAudioButtonState(isMuted: boolean) {
    if (!this.audioBtnEl) return;
    this.audioBtnEl.textContent = isMuted ? '🔇' : '🔊';
    this.audioBtnEl.setAttribute('aria-label', isMuted ? 'Unmute Background Music' : 'Mute Background Music');
    this.audioBtnEl.setAttribute('title', isMuted ? 'Unmute Background Music (Currently Silenced)' : 'Mute Background Music');
    if (isMuted) {
      this.audioBtnEl.classList.add('pk-audio-muted');
    } else {
      this.audioBtnEl.classList.remove('pk-audio-muted');
    }
  }

  public showToast(message: string, type: 'info' | 'success' | 'alert' = 'info') {
    // Keep max 3 toasts visible at once to avoid screen clutter on mobile
    while (this.toastContainer.children.length >= 3) {
      this.toastContainer.firstElementChild?.remove();
    }
    const toast = document.createElement('div');
    toast.className = `pk-hud-toast pk-toast-${type}`;
    toast.textContent = message;
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  public update(state: HUDState) {
    // 1. Update Match Timer
    const mins = Math.floor(state.remainingSeconds / 60);
    const secs = state.remainingSeconds % 60;
    this.timerValEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    this.roundValEl.textContent = `ROUND ${state.matchRound}`;

    // Audio status
    this.updateAudioButtonState(state.isMuted);

    // Network Status Badge
    if (state.isOffline) {
      this.currentRoomCode = null;
      this.netBadgeEl.className = 'pk-net-status-badge';
      this.netBadgeEl.innerHTML = `<span class="pk-net-dot">🤖</span><span class="pk-net-label">BOTS</span>`;
      this.netBadgeEl.title = 'Offline Practice Match';
    } else {
      this.currentRoomCode = state.roomCode ?? null;
      this.netBadgeEl.className = 'pk-net-status-badge is-online';
      const regionText = state.serverRegionName ? ` • ${state.serverRegionName}` : ' • 🇮🇳 Mumbai';
      const pingText = typeof state.latencyMs === 'number' ? ` • ${state.latencyMs}ms` : '';
      this.netBadgeEl.innerHTML = `<span class="pk-net-dot">🟢</span><span class="pk-net-label">${state.roomCode ? `ROOM ${state.roomCode}` : 'ONLINE'}${regionText}${pingText}</span><span class="pk-net-copy-hint">📋</span>`;
      this.netBadgeEl.title = state.roomCode ? `Room Code: ${state.roomCode}${regionText} (Tap to copy)` : 'Connected to Online Match';
    }

    // 2. Announcer Banner
    let bannerText = state.statusMessage;
    if (state.roundPhase === 'shooting') {
      const shooterName = state.currentShooterName ?? (state.currentShooterIndex >= 0 ? `Player ${state.currentShooterIndex + 1}` : 'Shooter');
      const timeTag = state.actionSecondsLeft !== undefined ? ` (⏱️ ${state.actionSecondsLeft}s)` : '';

      if (state.isMyTurn) {
        bannerText = `🎯 YOUR TURN TO FIRE!${timeTag}`;
      } else {
        bannerText = `⏳ Waiting for ${shooterName} to fire...${timeTag}`;
      }
    } else if (state.announcementMessage) {
      bannerText = state.announcementMessage;
    } else if (state.previousRoundMessage) {
      bannerText = state.previousRoundMessage;
    }
    this.announcerTextEl.textContent = bannerText;

    this.announcerEl.classList.remove('pk-alert-turn', 'pk-alert-notice');
    if (state.isMyTurn) {
      this.announcerEl.classList.add('pk-alert-turn');
    } else if (state.previousRoundMessage) {
      this.announcerEl.classList.add('pk-alert-notice');
    }

    // 3. Countdown Overlay
    if (state.roundPhase === 'counting' && state.countNumber > 0) {
      this.countdownEl.style.display = 'flex';
      this.countdownNumEl.textContent = String(state.countNumber);
      this.countdownSubEl.textContent = state.countNumber === 10 ? 'SHOOTER SELECTED!' : 'COUNTING...';
    } else {
      this.countdownEl.style.display = 'none';
    }

    // 4. Action Prompts
    if (state.roundPhase === 'shooting') {
      if (state.isMyTurn) {
        if (state.selectedWeapon === 'doublePeeranki') {
          if (state.pendingDoubleTargetIndex >= 0) {
            this.promptTextEl.textContent = '💥 Double Peeranki: Tap a different second target!';
            this.promptSubtextEl.textContent = 'Target 1 selected';
          } else {
            this.promptTextEl.textContent = '💥 Double Peeranki: Tap your first target';
            this.promptSubtextEl.textContent = '2 targets needed';
          }
        } else {
          this.promptTextEl.textContent = `🔫 Your turn! Tap an opponent to fire ${WEAPON_INFO[state.selectedWeapon]?.label ?? 'weapon'}`;
          this.promptSubtextEl.textContent = WEAPON_INFO[state.selectedWeapon]?.desc ?? '';
        }
      } else {
        this.promptTextEl.textContent = `Player ${state.currentShooterIndex + 1} is taking their shot...`;
        this.promptSubtextEl.textContent = 'Stand by';
      }
    } else if (state.roundPhase === 'counting') {
      this.promptTextEl.textContent = 'Counting in progress...';
      this.promptSubtextEl.textContent = `Number ${state.countNumber}/10`;
    } else if (state.roundPhase === 'duel') {
      this.promptTextEl.textContent = '⚔️ Rock–Paper–Scissors Duel in progress';
      this.promptSubtextEl.textContent = 'Lock in your move';
    } else {
      this.promptTextEl.textContent = state.statusMessage || 'Preparing for next round...';
      this.promptSubtextEl.textContent = '';
    }

    // 5. Weapon Selector Chips
    this.renderWeaponChips(state);
  }

  private renderWeaponChips(state: HUDState) {
    this.weaponChipsContainer.innerHTML = '';

    const activeWeapons = state.availableWeapons.filter(
      (w): w is WeaponType => w !== 'shield' && Boolean(WEAPON_INFO[w]),
    );

    // If active weapons is empty, default to gun
    const list = activeWeapons.length > 0 ? activeWeapons : (['gun'] as WeaponType[]);

    list.forEach((weapon) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `pk-weapon-chip ${weapon === state.selectedWeapon ? 'pk-selected' : ''}`;
      chip.setAttribute('aria-label', `Select ${WEAPON_INFO[weapon].label}`);

      chip.innerHTML = `
        <img class="pk-chip-icon" src="${WEAPON_INFO[weapon].icon}" alt="${WEAPON_INFO[weapon].label}" />
        <span>${WEAPON_INFO[weapon].label}</span>
      `;

      addFastTapListener(chip, () => {
        this.callbacks.onSelectWeapon(weapon);
      });

      this.weaponChipsContainer.appendChild(chip);
    });
  }
}
