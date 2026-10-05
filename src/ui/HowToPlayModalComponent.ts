// HowToPlayModalComponent.ts
// Interactive visual guide modal explaining Peeranki game mechanics:
// Tower destruction stages, Weapons arsenal & counters, RPS duels, and turn rules.

import { PeerankiAudio } from '../audio/PeerankiAudio';
import { addFastTapListener } from './touchUtils';

export interface GuideTab {
  id: 'towers' | 'weapons' | 'duels' | 'rules';
  title: string;
  icon: string;
}

export class HowToPlayModalComponent {
  private backdropEl: HTMLElement;
  private dialogEl: HTMLElement;
  private activeTab: 'towers' | 'weapons' | 'duels' | 'rules' = 'towers';
  private onCloseCallbacks: Array<() => void> = [];

  constructor() {
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'pk-modal-backdrop pk-howtoplay-backdrop';
    this.backdropEl.style.display = 'none';

    this.dialogEl = document.createElement('div');
    this.dialogEl.className = 'pk-howtoplay-dialog';
    this.backdropEl.appendChild(this.dialogEl);

    // Close on backdrop click outside dialog
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) {
        this.close();
      }
    });

    // Close on ESC key
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

  public onClose(callback: () => void): () => void {
    this.onCloseCallbacks.push(callback);
    return () => {
      this.onCloseCallbacks = this.onCloseCallbacks.filter((cb) => cb !== callback);
    };
  }

  public open(defaultTab: 'towers' | 'weapons' | 'duels' | 'rules' = 'towers') {
    this.activeTab = defaultTab;
    this.render();
    this.backdropEl.style.display = 'flex';
    PeerankiAudio.effect('select');
  }

  public close() {
    if (!this.isOpen()) return;
    this.backdropEl.style.display = 'none';
    PeerankiAudio.effect('click');
    this.onCloseCallbacks.forEach((cb) => cb());
  }

  private setTab(tab: 'towers' | 'weapons' | 'duels' | 'rules') {
    this.activeTab = tab;
    PeerankiAudio.effect('select');
    this.render();
  }

  private render() {
    this.dialogEl.innerHTML = `
      <div class="pk-htp-header">
        <div class="pk-htp-title-group">
          <span class="pk-htp-icon" aria-hidden="true">📖</span>
          <div>
            <h2 class="pk-htp-title">HOW TO PLAY PEERANKI</h2>
            <div class="pk-htp-subtitle">Traditional Kerala Strategy Game Guide</div>
          </div>
        </div>
        <button type="button" class="pk-htp-close-btn" aria-label="Close Guide">✕</button>
      </div>

      <div class="pk-htp-tabs">
        <button type="button" class="pk-htp-tab ${this.activeTab === 'towers' ? 'is-active' : ''}" data-tab="towers">
          <span>🏰</span> Towers & Stages
        </button>
        <button type="button" class="pk-htp-tab ${this.activeTab === 'weapons' ? 'is-active' : ''}" data-tab="weapons">
          <span>⚔️</span> Weapons Arsenal
        </button>
        <button type="button" class="pk-htp-tab ${this.activeTab === 'duels' ? 'is-active' : ''}" data-tab="duels">
          <span>✊</span> RPS Duels
        </button>
        <button type="button" class="pk-htp-tab ${this.activeTab === 'rules' ? 'is-active' : ''}" data-tab="rules">
          <span>📜</span> Match Flow
        </button>
      </div>

      <div class="pk-htp-body">
        ${this.renderTabContent()}
      </div>

      <div class="pk-htp-footer">
        <button type="button" class="pk-btn-primary pk-htp-confirm-btn">GOT IT, LET'S PLAY!</button>
      </div>
    `;

    // Event Listeners
    const closeBtn = this.dialogEl.querySelector('.pk-htp-close-btn')!;
    addFastTapListener(closeBtn as HTMLElement, () => this.close());

    const confirmBtn = this.dialogEl.querySelector('.pk-htp-confirm-btn')!;
    addFastTapListener(confirmBtn as HTMLElement, () => this.close());

    const tabButtons = this.dialogEl.querySelectorAll<HTMLButtonElement>('.pk-htp-tab');
    tabButtons.forEach((btn) => {
      addFastTapListener(btn, () => {
        const tab = btn.getAttribute('data-tab') as 'towers' | 'weapons' | 'duels' | 'rules';
        if (tab) this.setTab(tab);
      });
    });
  }

  private renderTabContent(): string {
    switch (this.activeTab) {
      case 'towers':
        return `
          <div class="pk-htp-section">
            <h3 class="pk-htp-section-title">Tower Destruction Stages</h3>
            <p class="pk-htp-desc">
              Every player controls a traditional Kerala fortress tower. When hit by standard weapons, your tower gradually splinters and crumbles until total elimination.
            </p>

            <div class="pk-htp-tower-stages-grid">
              <div class="pk-htp-stage-card">
                <div class="pk-htp-img-wrap">
                  <img src="assets/towers/tower_big.png" alt="Stage 0 - Big Tower" />
                </div>
                <div class="pk-htp-stage-name">Stage 1: Big Tower</div>
                <div class="pk-htp-stage-hp">3 HP (Full Fort)</div>
                <p class="pk-htp-stage-desc">Unbroken triple fortress. Strongest stance at round start.</p>
              </div>

              <div class="pk-htp-stage-arrow">➔</div>

              <div class="pk-htp-stage-card">
                <div class="pk-htp-img-wrap">
                  <img src="assets/towers/tower_small.png" alt="Stage 1 - Split Towers" />
                </div>
                <div class="pk-htp-stage-name">Stage 2: Split Towers</div>
                <div class="pk-htp-stage-hp">2 HP (Damaged)</div>
                <p class="pk-htp-stage-desc">Split into two smaller watchtowers after the first Gun strike.</p>
              </div>

              <div class="pk-htp-stage-arrow">➔</div>

              <div class="pk-htp-stage-card">
                <div class="pk-htp-img-wrap">
                  <img src="assets/towers/tower_one.png" alt="Stage 2 - Lone Tower" />
                </div>
                <div class="pk-htp-stage-name">Stage 3: Lone Tower</div>
                <div class="pk-htp-stage-hp">1 HP (Critical)</div>
                <p class="pk-htp-stage-desc">Single spire remaining. One more direct hit causes collapse!</p>
              </div>

              <div class="pk-htp-stage-arrow">➔</div>

              <div class="pk-htp-stage-card is-destroyed">
                <div class="pk-htp-img-wrap">
                  <img src="assets/towers/tower_destroyed.png" alt="Stage 3 - Destroyed Tower" />
                </div>
                <div class="pk-htp-stage-name">Stage 4: Destroyed</div>
                <div class="pk-htp-stage-hp">0 HP (Eliminated)</div>
                <p class="pk-htp-stage-desc">Fortress in ruins. Player eliminated from active shooting.</p>
              </div>
            </div>

            <div class="pk-htp-tip-box">
              <span class="pk-htp-tip-icon">💡</span>
              <div>
                <strong>Pro Tip:</strong> Heavy weapons like <strong>⚡ Peeranki</strong> bypass stage-by-stage chipping and instantly crush an unshielded tower to rubble in a single shot!
              </div>
            </div>
          </div>
        `;

      case 'weapons':
        return `
          <div class="pk-htp-section">
            <h3 class="pk-htp-section-title">The 5 Tactical Weapons</h3>
            <p class="pk-htp-desc">
              Weapons are unlocked round-by-round in strict Kerala festival order. Master weapon strengths and strategic counters to outmaneuver rivals!
            </p>

            <div class="pk-htp-weapons-list">
              <div class="pk-htp-weapon-row">
                <div class="pk-htp-w-icon">
                  <img src="assets/weapons/gun.png" alt="Gun" />
                </div>
                <div class="pk-htp-w-details">
                  <div class="pk-htp-w-header">
                    <span class="pk-htp-w-name">🔫 Gun (തോക്ക്)</span>
                    <span class="pk-htp-w-badge tier-1">Tier 1 • Starter</span>
                  </div>
                  <p class="pk-htp-w-text">
                    Standard single shot weapon. Reduces target tower by 1 stage. Blocked and absorbed completely by an active Shield.
                  </p>
                </div>
              </div>

              <div class="pk-htp-weapon-row">
                <div class="pk-htp-w-icon">
                  <img src="assets/weapons/peeranki.png" alt="Peeranki" />
                </div>
                <div class="pk-htp-w-details">
                  <div class="pk-htp-w-header">
                    <span class="pk-htp-w-name">⚡ Peeranki (പീരങ്കി Cannon)</span>
                    <span class="pk-htp-w-badge tier-2">Tier 2 • Heavy Artillery</span>
                  </div>
                  <p class="pk-htp-w-text">
                    Heavy festival cannon shot. Instantly destroys any unshielded tower! If the target has a shield, cracks and disables it for the entire round.
                  </p>
                </div>
              </div>

              <div class="pk-htp-weapon-row">
                <div class="pk-htp-w-icon">
                  <img src="assets/weapons/shield.png" alt="Shield" />
                </div>
                <div class="pk-htp-w-details">
                  <div class="pk-htp-w-header">
                    <span class="pk-htp-w-name">🛡️ Shield (പരിച)</span>
                    <span class="pk-htp-w-badge tier-3">Tier 3 • Passive Fortification</span>
                  </div>
                  <p class="pk-htp-w-text">
                    Passive defense barrier automatically active on your fortress. Absorbs incoming Gun shots with zero damage taken. Vulnerable to Hook and heavy Peeranki.
                  </p>
                </div>
              </div>

              <div class="pk-htp-weapon-row">
                <div class="pk-htp-w-icon">
                  <img src="assets/weapons/hook.png" alt="Hook" />
                </div>
                <div class="pk-htp-w-details">
                  <div class="pk-htp-w-header">
                    <span class="pk-htp-w-name">🪝 Hook (കൊളുത്ത്)</span>
                    <span class="pk-htp-w-badge tier-4">Tier 4 • Shield Breaker</span>
                  </div>
                  <p class="pk-htp-w-text">
                    Specialized siege grappling tool. Strips and permanently destroys an opponent's Shield for the rest of the game, leaving them vulnerable to cannon strikes!
                  </p>
                </div>
              </div>

              <div class="pk-htp-weapon-row">
                <div class="pk-htp-w-icon">
                  <img src="assets/weapons/double_peeranki.png" alt="Double Peeranki" />
                </div>
                <div class="pk-htp-w-details">
                  <div class="pk-htp-w-header">
                    <span class="pk-htp-w-name">💥 Double Peeranki (ഇരട്ട പീരങ്കി)</span>
                    <span class="pk-htp-w-badge tier-5">Tier 5 • Ultimate</span>
                  </div>
                  <p class="pk-htp-w-text">
                    Supreme artillery! Fires dual cannonballs at two distinct opponents in the same turn. Devastating crowd control in multiplayer arenas.
                  </p>
                </div>
              </div>
            </div>
          </div>
        `;

      case 'duels':
        return `
          <div class="pk-htp-section">
            <h3 class="pk-htp-section-title">Rock-Paper-Scissors Duels (RPS)</h3>
            <p class="pk-htp-desc">
              When combat narrows down to the <strong>final 2 standing fortresses</strong> in a round, the battle enters an epic showdown duel!
            </p>

            <div class="pk-htp-duel-diagram">
              <div class="pk-htp-rps-card">
                <div class="pk-htp-rps-emoji">🪨</div>
                <div class="pk-htp-rps-title">ROCK</div>
                <div class="pk-htp-rps-beats">Beats ✂️ Scissors</div>
              </div>

              <div class="pk-htp-duel-vs">⚔️</div>

              <div class="pk-htp-rps-card">
                <div class="pk-htp-rps-emoji">📄</div>
                <div class="pk-htp-rps-title">PAPER</div>
                <div class="pk-htp-rps-beats">Beats 🪨 Rock</div>
              </div>

              <div class="pk-htp-duel-vs">⚔️</div>

              <div class="pk-htp-rps-card">
                <div class="pk-htp-rps-emoji">✂️</div>
                <div class="pk-htp-rps-title">SCISSORS</div>
                <div class="pk-htp-rps-beats">Beats 📄 Paper</div>
              </div>
            </div>

            <div class="pk-htp-duel-rules-box">
              <div class="pk-htp-rule-item">
                <span class="pk-htp-bullet">1.</span>
                <span>Both finalists pick Rock, Paper, or Scissors before the duel timer expires.</span>
              </div>
              <div class="pk-htp-rule-item">
                <span class="pk-htp-bullet">2.</span>
                <span>If both pick the same hand, it's a <strong>Tie</strong> and the duel repeats immediately!</span>
              </div>
              <div class="pk-htp-rule-item">
                <span class="pk-htp-bullet">3.</span>
                <span>The winner takes the <strong>Round Victory</strong> and unlocks the next weapon in progression!</span>
              </div>
            </div>
          </div>
        `;

      case 'rules':
        return `
          <div class="pk-htp-section">
            <h3 class="pk-htp-section-title">Turn Cycle & Winning Conditions</h3>
            <p class="pk-htp-desc">
              Peeranki matches combine rhythmic Kerala counting, tactical shooting, and tournament points.
            </p>

            <div class="pk-htp-flow-steps">
              <div class="pk-htp-step">
                <div class="pk-htp-step-num">1</div>
                <div class="pk-htp-step-content">
                  <h4>The Count (കൗണ്ടിംഗ്)</h4>
                  <p>A count moves sequentially from tower to tower (up to 20). The player on whom the count lands becomes the active shooter.</p>
                </div>
              </div>

              <div class="pk-htp-step">
                <div class="pk-htp-step-num">2</div>
                <div class="pk-htp-step-content">
                  <h4>Shooting Turn</h4>
                  <p>When it is your turn, select an owned weapon from the bottom arsenal, then click on any enemy tower to fire. You have a 30-second action timer.</p>
                </div>
              </div>

              <div class="pk-htp-step">
                <div class="pk-htp-step-num">3</div>
                <div class="pk-htp-step-content">
                  <h4>Round Winner & Weapon Upgrade</h4>
                  <p>The last surviving player or the duel winner earns a new weapon in the progression: Gun ➔ Peeranki ➔ Shield ➔ Hook ➔ Double Peeranki.</p>
                </div>
              </div>

              <div class="pk-htp-step">
                <div class="pk-htp-step-num">4</div>
                <div class="pk-htp-step-content">
                  <h4>Winning the Match</h4>
                  <p>Be the first player to collect all 5 weapons, or hold the highest score and most weapons when the match duration clock expires!</p>
                </div>
              </div>
            </div>
          </div>
        `;
    }
  }
}

// Global modal instance for quick invocation from any scene or component
let globalGuideModal: HowToPlayModalComponent | null = null;

export function getHowToPlayModal(): HowToPlayModalComponent {
  if (!globalGuideModal) {
    globalGuideModal = new HowToPlayModalComponent();
    document.body.appendChild(globalGuideModal.getElement());
  }
  return globalGuideModal;
}

export function showHowToPlayModal(tab: 'towers' | 'weapons' | 'duels' | 'rules' = 'towers') {
  const modal = getHowToPlayModal();
  modal.open(tab);
}
