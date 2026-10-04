import type { HUDState, UICallbacks, WeaponType } from './types';
import { showHowToPlayModal } from './HowToPlayModalComponent';

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
        <img class="pk-topbar-logo" src="assets/peeranki-logo.png" alt="Peeranki Logo" />
        <span class="pk-topbar-title">PEERANKI</span>
      </div>
      <div class="pk-topbar-meta">
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
    const fullscreenBtn = this.topbarEl.querySelector<HTMLButtonElement>('.pk-btn-fullscreen');
    const helpBtn = this.topbarEl.querySelector('.pk-btn-help');
    const leaveBtn = this.topbarEl.querySelector('.pk-btn-leave')!;

    if (fullscreenBtn) {
      const updateFsIcon = () => {
        const isFs = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
        fullscreenBtn.textContent = isFs ? '✕' : '⛶';
        fullscreenBtn.title = isFs ? 'Exit Fullscreen' : 'Enter Fullscreen';
      };

      fullscreenBtn.addEventListener('click', () => {
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

    helpBtn?.addEventListener('click', () => {
      showHowToPlayModal();
    });

    // Initialize initial mute state from global storage
    try {
      const isInitiallyMuted = localStorage.getItem('peeranki_music_muted') === 'true';
      this.updateAudioButtonState(isInitiallyMuted);
    } catch {
      // ignore
    }

    this.audioBtnEl.addEventListener('click', () => {
      const isMuted = this.callbacks.onToggleAudio();
      this.updateAudioButtonState(isMuted);
    });

    leaveBtn.addEventListener('click', () => {
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

    prevBtn.addEventListener('click', () => this.callbacks.onCycleWeapon(-1));
    nextBtn.addEventListener('click', () => this.callbacks.onCycleWeapon(1));
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

  public update(state: HUDState) {
    // 1. Update Match Timer
    const mins = Math.floor(state.remainingSeconds / 60);
    const secs = state.remainingSeconds % 60;
    this.timerValEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    this.roundValEl.textContent = `ROUND ${state.matchRound}`;

    // Audio status
    this.updateAudioButtonState(state.isMuted);

    // 2. Announcer Banner
    let bannerText = state.statusMessage;
    if (state.announcementMessage) {
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

      chip.addEventListener('click', () => {
        this.callbacks.onSelectWeapon(weapon);
      });

      this.weaponChipsContainer.appendChild(chip);
    });
  }
}
