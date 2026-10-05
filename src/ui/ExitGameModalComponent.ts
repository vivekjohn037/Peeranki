import { addFastTapListener } from './touchUtils';
import { PeerankiAudio } from '../audio/PeerankiAudio';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

declare global {
  interface Window {
    peerankiDesktop?: {
      setFullscreen: (fullscreen: boolean) => Promise<boolean>;
      onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
      quit: () => void;
    };
  }
}

export class ExitGameModalComponent {
  private backdropEl: HTMLElement;
  private dialogEl: HTMLElement;
  private onConfirmCallback?: () => void;

  constructor() {
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'pk-modal-backdrop pk-exit-backdrop';
    this.backdropEl.style.display = 'none';

    this.dialogEl = document.createElement('div');
    this.dialogEl.className = 'pk-exit-dialog';
    this.backdropEl.appendChild(this.dialogEl);

    // Close on backdrop click outside dialog
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) {
        this.close();
      }
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  public getElement(): HTMLElement {
    return this.backdropEl;
  }

  public isOpen(): boolean {
    return this.backdropEl.style.display !== 'none';
  }

  public open(onConfirm?: () => void) {
    this.onConfirmCallback = onConfirm;
    this.renderPrompt();
    this.backdropEl.style.display = 'flex';
    PeerankiAudio.effect('select');
  }

  public close() {
    this.backdropEl.style.display = 'none';
  }

  private renderPrompt() {
    this.dialogEl.innerHTML = `
      <div class="pk-exit-icon-badge">⚠️</div>
      <div class="pk-exit-title">EXIT GAME?</div>
      <div class="pk-exit-warning-card">
        <span class="pk-warning-symbol">⚠️</span>
        <p class="pk-exit-warning-text">
          <strong>Warning:</strong> Any unsaved game progress or active multiplayer connection will be terminated.
        </p>
      </div>
      <div class="pk-exit-desc">
        Are you sure you want to close Peeranki and quit the application?
      </div>
      <div class="pk-exit-actions">
        <button type="button" class="pk-btn-exit-cancel">CANCEL</button>
        <button type="button" class="pk-btn-exit-confirm">EXIT GAME</button>
      </div>
    `;

    const cancelBtn = this.dialogEl.querySelector('.pk-btn-exit-cancel') as HTMLElement;
    const confirmBtn = this.dialogEl.querySelector('.pk-btn-exit-confirm') as HTMLElement;

    addFastTapListener(cancelBtn, () => {
      PeerankiAudio.effect('click');
      this.close();
    });

    addFastTapListener(confirmBtn, async () => {
      PeerankiAudio.effect('click');
      if (this.onConfirmCallback) {
        this.onConfirmCallback();
      }
      await this.executeExit();
    });
  }

  private async executeExit() {
    try {
      if (window.peerankiDesktop?.quit) {
        window.peerankiDesktop.quit();
        return;
      }
      if (Capacitor.isNativePlatform?.() || Capacitor.getPlatform() === 'android') {
        await App.exitApp();
        return;
      }
    } catch {
      // Continue to browser fallback
    }

    try {
      window.close();
    } catch {
      // ignore
    }

    // In web browsers where window.close() is blocked, display clean closed state
    this.renderClosedScreen();
  }

  private renderClosedScreen() {
    this.dialogEl.innerHTML = `
      <div class="pk-exit-closed-view">
        <div style="font-size: 48px;">👋</div>
        <div class="pk-exit-title">GAME CLOSED</div>
        <p class="pk-exit-desc" style="color: #94a3b8; margin-bottom: 16px;">
          Thank you for playing <strong>Peeranki</strong>! You can now safely close this browser window or tab.
        </p>
        <button type="button" class="pk-btn-exit-cancel" style="min-width: 160px;">RELOAD GAME</button>
      </div>
    `;

    const reloadBtn = this.dialogEl.querySelector('.pk-btn-exit-cancel') as HTMLElement;
    addFastTapListener(reloadBtn, () => {
      window.location.reload();
    });
  }
}

// Global modal singleton instance for quick invocation
let globalExitModal: ExitGameModalComponent | null = null;

export function getExitGameModal(): ExitGameModalComponent {
  if (!globalExitModal) {
    globalExitModal = new ExitGameModalComponent();
    document.body.appendChild(globalExitModal.getElement());
  }
  return globalExitModal;
}

export function showExitGameModal(onConfirm?: () => void) {
  const modal = getExitGameModal();
  modal.open(onConfirm);
}
