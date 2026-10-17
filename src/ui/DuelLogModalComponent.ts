import { duelLogManager } from '../game/DuelLogManager';
import type { DuelOutcomeEntry } from '../game/DuelLogManager';
import { soundEffectManager } from '../game/SoundEffectManager';
import { addFastTapListener } from './touchUtils';
import { escapeHtml } from './html';

const RPS_EMOJIS: Record<string, string> = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
};

const RPS_TITLES: Record<string, string> = {
  rock: 'ROCK',
  paper: 'PAPER',
  scissors: 'SCISSORS',
};

export class DuelLogModalComponent {
  private backdropEl: HTMLElement;
  private dialogEl: HTMLElement;
  private activeTab: 'watch' | 'summary' = 'watch';
  private entries: DuelOutcomeEntry[] = [];
  private currentReplayIndex = 0;
  private isAutoPlaying = false;
  private playbackTimer?: number;
  private playbackSpeed: 1 | 2 = 1;
  private isShowing = false;
  private sourceFilter: 'auto' | 'current' | 'recent' = 'auto';

  constructor() {
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'pk-modal-backdrop pk-duellog-backdrop';
    this.backdropEl.style.display = 'none';

    this.dialogEl = document.createElement('div');
    this.dialogEl.className = 'pk-duellog-dialog';
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
    return this.isShowing && this.backdropEl.style.display !== 'none';
  }

  public open(preferredTab: 'watch' | 'summary' = 'watch') {
    this.activeTab = preferredTab;
    this.stopPlayback();
    this.refreshEntries();
    this.currentReplayIndex = 0;
    this.render();
    this.backdropEl.style.display = 'flex';
    this.isShowing = true;
    soundEffectManager.playClip('duel_start');

    // If opening into watch mode and there are multiple entries, start auto-play with small delay
    if (this.activeTab === 'watch' && this.entries.length > 0) {
      setTimeout(() => {
        if (this.isOpen() && this.activeTab === 'watch') {
          this.startPlayback();
        }
      }, 400);
    }
  }

  public close() {
    this.stopPlayback();
    this.backdropEl.style.display = 'none';
    this.isShowing = false;
    soundEffectManager.playClip('hit');
  }

  private refreshEntries() {
    if (this.sourceFilter === 'current') {
      this.entries = duelLogManager.getCurrentMatchLog();
    } else if (this.sourceFilter === 'recent') {
      this.entries = duelLogManager.getRecentHistory();
    } else {
      const effective = duelLogManager.getEffectiveLog();
      this.entries = effective.entries;
    }
  }

  private stopPlayback() {
    this.isAutoPlaying = false;
    if (this.playbackTimer) {
      window.clearTimeout(this.playbackTimer);
      this.playbackTimer = undefined;
    }
  }

  private startPlayback() {
    this.stopPlayback();
    if (this.entries.length === 0) return;
    this.isAutoPlaying = true;
    this.updateControlsUI();
    this.scheduleNextFrame();
  }

  private scheduleNextFrame() {
    if (!this.isAutoPlaying || !this.isOpen() || this.activeTab !== 'watch') return;

    const interval = Math.round(2600 / this.playbackSpeed);
    this.playbackTimer = window.setTimeout(() => {
      if (!this.isAutoPlaying || !this.isOpen()) return;

      if (this.currentReplayIndex < this.entries.length - 1) {
        this.currentReplayIndex++;
        this.renderReplayArena();
        this.scheduleNextFrame();
      } else {
        // Finished playback
        this.stopPlayback();
        this.updateControlsUI();
      }
    }, interval);
  }

  private stepNext() {
    this.stopPlayback();
    if (this.currentReplayIndex < this.entries.length - 1) {
      this.currentReplayIndex++;
      this.renderReplayArena();
    }
    this.updateControlsUI();
  }

  private stepPrev() {
    this.stopPlayback();
    if (this.currentReplayIndex > 0) {
      this.currentReplayIndex--;
      this.renderReplayArena();
    }
    this.updateControlsUI();
  }

  private restartReplay() {
    this.stopPlayback();
    this.currentReplayIndex = 0;
    this.renderReplayArena();
    this.startPlayback();
  }

  private triggerClashAudio(entry: DuelOutcomeEntry) {
    if (entry.result === 'tie') {
      soundEffectManager.playDuelTie();
    } else {
      soundEffectManager.playDuelWin();
    }
  }

  public render() {
    const stats = duelLogManager.getDuelStats(this.entries);
    const hasEntries = this.entries.length > 0;
    const isSample = this.entries[0]?.isSample ?? false;

    this.dialogEl.innerHTML = `
      <div class="pk-duellog-header">
        <div class="pk-duellog-title-group">
          <div class="pk-duellog-badge">⚔️ RECENT SHOWDOWNS</div>
          <h2 class="pk-duellog-title">DUEL COMBAT LOG & SUMMARY</h2>
          <div class="pk-duellog-subtitle">
            ${isSample ? '⚡ Demo simulation record (No duels were fought before elimination in this match)' : `Showing ${this.entries.length} duel clash outcome${this.entries.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <button type="button" class="pk-duellog-close-btn" aria-label="Close dialog">✕</button>
      </div>

      <!-- Tab Navigator -->
      <div class="pk-duellog-tabs">
        <button type="button" class="pk-duellog-tab ${this.activeTab === 'watch' ? 'active' : ''}" data-tab="watch">
          ▶️ WATCH REPLAY
        </button>
        <button type="button" class="pk-duellog-tab ${this.activeTab === 'summary' ? 'active' : ''}" data-tab="summary">
          📜 TEXT SUMMARY & STATS
        </button>
      </div>

      <!-- Tab Content Area -->
      <div class="pk-duellog-body">
        ${this.activeTab === 'watch' ? this.buildWatchViewHtml(hasEntries) : this.buildSummaryViewHtml(stats)}
      </div>

      <!-- Footer Actions -->
      <div class="pk-duellog-footer">
        <div class="pk-duellog-footer-left">
          <button type="button" class="pk-btn-subtle pk-duellog-filter-btn" title="Toggle current match or all recent matches">
            ${this.sourceFilter === 'current' ? '🔍 Filter: Match Only' : this.sourceFilter === 'recent' ? '🔍 Filter: Recent History' : '🔍 All Outcomes'}
          </button>
        </div>
        <button type="button" class="pk-btn-primary pk-duellog-back-btn">
          ⬅️ BACK TO RESULTS
        </button>
      </div>
    `;

    this.bindEvents();
    if (this.activeTab === 'watch' && hasEntries) {
      this.renderReplayArena();
    }
  }

  private buildWatchViewHtml(hasEntries: boolean): string {
    if (!hasEntries) {
      return `
        <div class="pk-duellog-empty-state">
          <div class="pk-duellog-empty-icon">🛡️</div>
          <div class="pk-duellog-empty-title">No Duels Recorded Yet</div>
          <div class="pk-duellog-empty-desc">
            Duels trigger when only 2 players remain alive in a 1-on-1 Rock-Paper-Scissors showdown.
          </div>
          <button type="button" class="pk-btn-secondary pk-btn-load-sample" style="margin-top: 14px;">
            Load Sample Showdown
          </button>
        </div>
      `;
    }

    return `
      <div class="pk-duellog-watch-view">
        <!-- Replay Controls Bar -->
        <div class="pk-duellog-controls-bar">
          <div class="pk-duellog-ctrl-group">
            <button type="button" class="pk-duellog-ctrl-btn pk-btn-restart" title="Restart from clash 1">↺</button>
            <button type="button" class="pk-duellog-ctrl-btn pk-btn-prev" title="Previous clash">◀</button>
            <button type="button" class="pk-duellog-ctrl-btn pk-duellog-play-btn pk-btn-play-toggle" title="Play or Pause">
              ${this.isAutoPlaying ? '⏸ PAUSE' : '▶ PLAY'}
            </button>
            <button type="button" class="pk-duellog-ctrl-btn pk-btn-next" title="Next clash">▶</button>
            <button type="button" class="pk-duellog-ctrl-btn pk-btn-speed" title="Playback speed">${this.playbackSpeed}x</button>
          </div>
          <div class="pk-duellog-counter-badge">
            <span class="pk-current-step">1</span> of <span class="pk-total-steps">${this.entries.length}</span>
          </div>
        </div>

        <!-- Progress Timeline -->
        <div class="pk-duellog-timeline">
          <div class="pk-duellog-timeline-bar" style="width: 0%;"></div>
        </div>

        <!-- Arena Display -->
        <div class="pk-duellog-arena-container">
          <!-- Populated dynamically by renderReplayArena -->
        </div>

        <!-- Narrative Log Ticker -->
        <div class="pk-duellog-narrative-box">
          <span class="pk-narrative-tag">COMMENTARY LOG</span>
          <div class="pk-narrative-text">Loading clash...</div>
        </div>
      </div>
    `;
  }

  private buildSummaryViewHtml(stats: ReturnType<typeof duelLogManager.getDuelStats>): string {
    const formattedText = duelLogManager.generateFormattedTextSummary(this.entries);

    return `
      <div class="pk-duellog-summary-view">
        <!-- Stat KPI Chips -->
        <div class="pk-duellog-kpi-grid">
          <div class="pk-duellog-kpi-card">
            <div class="pk-kpi-value">${stats.totalClashes}</div>
            <div class="pk-kpi-label">Total Clashes</div>
          </div>
          <div class="pk-duellog-kpi-card kpi-win">
            <div class="pk-kpi-value">${stats.totalDecisiveWins}</div>
            <div class="pk-kpi-label">Decisive Wins</div>
          </div>
          <div class="pk-duellog-kpi-card kpi-tie">
            <div class="pk-kpi-value">${stats.totalTies}</div>
            <div class="pk-kpi-label">Stalemate Ties</div>
          </div>
          <div class="pk-duellog-kpi-card kpi-fav">
            <div class="pk-kpi-value">${stats.mostFavoredChoice.toUpperCase()}</div>
            <div class="pk-kpi-label">Dominant Weapon</div>
          </div>
        </div>

        <!-- Action bar -->
        <div class="pk-duellog-summary-actions">
          <span class="pk-duellog-format-hint">📄 Formatted Text Audit Log (${this.entries.length} entries)</span>
          <button type="button" class="pk-btn-subtle pk-btn-copy-log">
            📋 COPY LOG TO CLIPBOARD
          </button>
        </div>

        <!-- Formatted Monospace Log Display -->
        <div class="pk-duellog-text-wrapper">
          <pre class="pk-duellog-pre">${escapeHtml(formattedText)}</pre>
        </div>
      </div>
    `;
  }

  private renderReplayArena() {
    const arenaEl = this.dialogEl.querySelector('.pk-duellog-arena-container');
    const narrativeEl = this.dialogEl.querySelector('.pk-narrative-text');
    const timelineBar = this.dialogEl.querySelector('.pk-duellog-timeline-bar') as HTMLElement | null;
    const currentStepEl = this.dialogEl.querySelector('.pk-current-step');
    const totalStepEl = this.dialogEl.querySelector('.pk-total-steps');

    if (!arenaEl || this.entries.length === 0) return;

    const entry = this.entries[this.currentReplayIndex];
    if (!entry) return;

    if (currentStepEl) currentStepEl.textContent = String(this.currentReplayIndex + 1);
    if (totalStepEl) totalStepEl.textContent = String(this.entries.length);

    if (timelineBar) {
      const percent = Math.round(((this.currentReplayIndex + 1) / this.entries.length) * 100);
      timelineBar.style.width = `${percent}%`;
    }

    const p1 = entry.player1;
    const p2 = entry.player2;
    const isTie = entry.result === 'tie';

    const p1IsWinner = entry.winnerId === p1.id;
    const p2IsWinner = entry.winnerId === p2.id;

    const p1CardClass = isTie ? 'tie' : p1IsWinner ? 'winner' : 'loser';
    const p2CardClass = isTie ? 'tie' : p2IsWinner ? 'winner' : 'loser';

    const p1Emoji = RPS_EMOJIS[p1.choice] || '🪨';
    const p2Emoji = RPS_EMOJIS[p2.choice] || '🪨';

    const p1Title = RPS_TITLES[p1.choice] || 'WEAPON';
    const p2Title = RPS_TITLES[p2.choice] || 'WEAPON';

    arenaEl.innerHTML = `
      <div class="pk-clash-arena">
        <!-- Fighter 1 Card -->
        <div class="pk-fighter-card ${p1CardClass}">
          <div class="pk-fighter-badge">${p1IsWinner ? '🏆 WINNER' : isTie ? '🤝 TIE' : 'DEFEATED'}</div>
          <div class="pk-fighter-avatar">👤</div>
          <div class="pk-fighter-name">${escapeHtml(p1.name)}</div>
          <div class="pk-fighter-weapon-box">
            <div class="pk-fighter-weapon-emoji">${p1Emoji}</div>
            <div class="pk-fighter-weapon-title">${p1Title}</div>
          </div>
        </div>

        <!-- Center Clash Emblem -->
        <div class="pk-clash-center">
          <div class="pk-clash-round-tag">Round ${entry.round} · Clash #${entry.clashNumber}</div>
          <div class="pk-clash-vs-emblem">${isTie ? '🤝' : '⚔️'}</div>
          <div class="pk-clash-verdict-tag ${isTie ? 'verdict-tie' : 'verdict-win'}">
            ${isTie ? 'STALEMATE' : `${escapeHtml(entry.winnerName ?? 'VICTORY')} WINS!`}
          </div>
        </div>

        <!-- Fighter 2 Card -->
        <div class="pk-fighter-card ${p2CardClass}">
          <div class="pk-fighter-badge">${p2IsWinner ? '🏆 WINNER' : isTie ? '🤝 TIE' : 'DEFEATED'}</div>
          <div class="pk-fighter-avatar">🤖</div>
          <div class="pk-fighter-name">${escapeHtml(p2.name)}</div>
          <div class="pk-fighter-weapon-box">
            <div class="pk-fighter-weapon-emoji">${p2Emoji}</div>
            <div class="pk-fighter-weapon-title">${p2Title}</div>
          </div>
        </div>
      </div>
    `;

    if (narrativeEl) {
      narrativeEl.textContent = entry.narrative;
    }

    this.triggerClashAudio(entry);
    this.updateControlsUI();
  }

  private updateControlsUI() {
    const playBtn = this.dialogEl.querySelector('.pk-btn-play-toggle');
    if (playBtn) {
      playBtn.textContent = this.isAutoPlaying ? '⏸ PAUSE' : '▶ PLAY';
    }

    const prevBtn = this.dialogEl.querySelector('.pk-btn-prev') as HTMLButtonElement | null;
    const nextBtn = this.dialogEl.querySelector('.pk-btn-next') as HTMLButtonElement | null;
    if (prevBtn) prevBtn.disabled = this.currentReplayIndex <= 0;
    if (nextBtn) nextBtn.disabled = this.currentReplayIndex >= this.entries.length - 1;

    const speedBtn = this.dialogEl.querySelector('.pk-btn-speed');
    if (speedBtn) speedBtn.textContent = `${this.playbackSpeed}x`;
  }

  private bindEvents() {
    // Close button
    const closeBtn = this.dialogEl.querySelector('.pk-duellog-close-btn');
    if (closeBtn) {
      addFastTapListener(closeBtn as HTMLElement, () => this.close());
    }

    // Back to results button
    const backBtn = this.dialogEl.querySelector('.pk-duellog-back-btn');
    if (backBtn) {
      addFastTapListener(backBtn as HTMLElement, () => this.close());
    }

    // Tab buttons
    this.dialogEl.querySelectorAll('.pk-duellog-tab').forEach((tabBtn) => {
      addFastTapListener(tabBtn as HTMLElement, () => {
        const tab = (tabBtn as HTMLElement).dataset.tab as 'watch' | 'summary';
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.stopPlayback();
          this.render();
        }
      });
    });

    // Replay controls
    const playToggleBtn = this.dialogEl.querySelector('.pk-btn-play-toggle');
    if (playToggleBtn) {
      addFastTapListener(playToggleBtn as HTMLElement, () => {
        if (this.isAutoPlaying) {
          this.stopPlayback();
          this.updateControlsUI();
        } else {
          if (this.currentReplayIndex >= this.entries.length - 1) {
            this.currentReplayIndex = 0;
            this.renderReplayArena();
          }
          this.startPlayback();
        }
      });
    }

    const restartBtn = this.dialogEl.querySelector('.pk-btn-restart');
    if (restartBtn) {
      addFastTapListener(restartBtn as HTMLElement, () => this.restartReplay());
    }

    const prevBtn = this.dialogEl.querySelector('.pk-btn-prev');
    if (prevBtn) {
      addFastTapListener(prevBtn as HTMLElement, () => this.stepPrev());
    }

    const nextBtn = this.dialogEl.querySelector('.pk-btn-next');
    if (nextBtn) {
      addFastTapListener(nextBtn as HTMLElement, () => this.stepNext());
    }

    const speedBtn = this.dialogEl.querySelector('.pk-btn-speed');
    if (speedBtn) {
      addFastTapListener(speedBtn as HTMLElement, () => {
        this.playbackSpeed = this.playbackSpeed === 1 ? 2 : 1;
        this.updateControlsUI();
        if (this.isAutoPlaying) {
          this.scheduleNextFrame();
        }
      });
    }

    // Copy Log Button
    const copyBtn = this.dialogEl.querySelector('.pk-btn-copy-log');
    if (copyBtn) {
      addFastTapListener(copyBtn as HTMLElement, async () => {
        const text = duelLogManager.generateFormattedTextSummary(this.entries);
        try {
          await navigator.clipboard.writeText(text);
          const orig = copyBtn.textContent;
          copyBtn.textContent = '✅ COPIED TO CLIPBOARD!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = orig;
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch {
          // Fallback if clipboard API is constrained
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = '✅ COPIED!';
          setTimeout(() => { copyBtn.textContent = '📋 COPY LOG TO CLIPBOARD'; }, 2000);
        }
      });
    }

    // Filter button
    const filterBtn = this.dialogEl.querySelector('.pk-duellog-filter-btn');
    if (filterBtn) {
      addFastTapListener(filterBtn as HTMLElement, () => {
        if (this.sourceFilter === 'auto') this.sourceFilter = 'current';
        else if (this.sourceFilter === 'current') this.sourceFilter = 'recent';
        else this.sourceFilter = 'auto';

        this.stopPlayback();
        this.refreshEntries();
        this.currentReplayIndex = 0;
        this.render();
      });
    }

    // Sample load button if empty
    const sampleBtn = this.dialogEl.querySelector('.pk-btn-load-sample');
    if (sampleBtn) {
      addFastTapListener(sampleBtn as HTMLElement, () => {
        this.entries = duelLogManager.generateSampleDuelLog();
        this.currentReplayIndex = 0;
        this.render();
        this.startPlayback();
      });
    }
  }
}
