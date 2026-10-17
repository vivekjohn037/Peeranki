import React, { useState, useEffect } from 'react';
import { duelLogManager, type DuelOutcomeEntry } from '../game/DuelLogManager';
import { soundEffectManager } from '../game/SoundEffectManager';

interface DuelLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferredTab?: 'watch' | 'summary';
}

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

export const DuelLogModal: React.FC<DuelLogModalProps> = ({
  isOpen,
  onClose,
  preferredTab = 'watch',
}) => {
  const [activeTab, setActiveTab] = useState<'watch' | 'summary'>(preferredTab);
  const [entries, setEntries] = useState<DuelOutcomeEntry[]>([]);
  const [currentReplayIndex, setCurrentReplayIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2>(1);
  const [sourceFilter, setSourceFilter] = useState<'auto' | 'current' | 'recent'>('auto');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(preferredTab);
      loadEntries(sourceFilter);
      setCurrentReplayIndex(0);
      setIsAutoPlaying(false);
      soundEffectManager.playClip('duel_start');
    }
  }, [isOpen, preferredTab, sourceFilter]);

  const loadEntries = (filter: 'auto' | 'current' | 'recent') => {
    if (filter === 'current') {
      setEntries(duelLogManager.getCurrentMatchLog());
    } else if (filter === 'recent') {
      setEntries(duelLogManager.getRecentHistory());
    } else {
      const eff = duelLogManager.getEffectiveLog();
      setEntries(eff.entries);
    }
  };

  useEffect(() => {
    let timer: number | undefined;
    if (isAutoPlaying && isOpen && activeTab === 'watch' && entries.length > 0) {
      const interval = Math.round(2600 / playbackSpeed);
      timer = window.setTimeout(() => {
        if (currentReplayIndex < entries.length - 1) {
          const nextIdx = currentReplayIndex + 1;
          setCurrentReplayIndex(nextIdx);
          triggerClashAudio(entries[nextIdx]);
        } else {
          setIsAutoPlaying(false);
        }
      }, interval);
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isAutoPlaying, isOpen, activeTab, entries, currentReplayIndex, playbackSpeed]);

  if (!isOpen) return null;

  const triggerClashAudio = (entry?: DuelOutcomeEntry) => {
    if (!entry) return;
    if (entry.result === 'tie') {
      soundEffectManager.playDuelTie();
    } else {
      soundEffectManager.playDuelWin();
    }
  };

  const handleRestart = () => {
    setIsAutoPlaying(false);
    setCurrentReplayIndex(0);
    triggerClashAudio(entries[0]);
    setIsAutoPlaying(true);
  };

  const handlePrev = () => {
    setIsAutoPlaying(false);
    if (currentReplayIndex > 0) {
      const prev = currentReplayIndex - 1;
      setCurrentReplayIndex(prev);
      triggerClashAudio(entries[prev]);
    }
  };

  const handleNext = () => {
    setIsAutoPlaying(false);
    if (currentReplayIndex < entries.length - 1) {
      const next = currentReplayIndex + 1;
      setCurrentReplayIndex(next);
      triggerClashAudio(entries[next]);
    }
  };

  const handleTogglePlay = () => {
    if (isAutoPlaying) {
      setIsAutoPlaying(false);
    } else {
      if (currentReplayIndex >= entries.length - 1) {
        setCurrentReplayIndex(0);
      }
      setIsAutoPlaying(true);
    }
  };

  const handleCopy = async () => {
    const text = duelLogManager.generateFormattedTextSummary(entries);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleToggleFilter = () => {
    let next: 'auto' | 'current' | 'recent' = 'auto';
    if (sourceFilter === 'auto') next = 'current';
    else if (sourceFilter === 'current') next = 'recent';
    else next = 'auto';
    setSourceFilter(next);
    loadEntries(next);
    setCurrentReplayIndex(0);
    setIsAutoPlaying(false);
  };

  const stats = duelLogManager.getDuelStats(entries);
  const currentEntry = entries[currentReplayIndex];
  const progressPercent = entries.length > 0 ? Math.round(((currentReplayIndex + 1) / entries.length) * 100) : 0;
  const isSample = entries[0]?.isSample ?? false;

  return (
    <div
      className="pk-modal-backdrop pk-duellog-backdrop"
      style={{ display: 'flex' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pk-duellog-dialog">
        <div className="pk-duellog-header">
          <div className="pk-duellog-title-group">
            <div className="pk-duellog-badge">⚔️ RECENT SHOWDOWNS</div>
            <h2 className="pk-duellog-title">DUEL COMBAT LOG & SUMMARY</h2>
            <div className="pk-duellog-subtitle">
              {isSample
                ? '⚡ Demo simulation record (No duels were fought before elimination in this match)'
                : `Showing ${entries.length} duel clash outcome${entries.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <button type="button" className="pk-duellog-close-btn" aria-label="Close dialog" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Tab Navigator */}
        <div className="pk-duellog-tabs">
          <button
            type="button"
            className={`pk-duellog-tab ${activeTab === 'watch' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('watch');
              setIsAutoPlaying(false);
            }}
          >
            ▶️ WATCH REPLAY
          </button>
          <button
            type="button"
            className={`pk-duellog-tab ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('summary');
              setIsAutoPlaying(false);
            }}
          >
            📜 TEXT SUMMARY & STATS
          </button>
        </div>

        {/* Body Content */}
        <div className="pk-duellog-body">
          {activeTab === 'watch' ? (
            entries.length === 0 ? (
              <div className="pk-duellog-empty-state">
                <div className="pk-duellog-empty-icon">🛡️</div>
                <div className="pk-duellog-empty-title">No Duels Recorded Yet</div>
                <div className="pk-duellog-empty-desc">
                  Duels trigger when only 2 players remain alive in a 1-on-1 Rock-Paper-Scissors showdown.
                </div>
                <button
                  type="button"
                  className="pk-btn-secondary pk-btn-load-sample"
                  style={{ marginTop: '14px' }}
                  onClick={() => {
                    const sample = duelLogManager.generateSampleDuelLog();
                    setEntries(sample);
                    setCurrentReplayIndex(0);
                    setIsAutoPlaying(true);
                  }}
                >
                  Load Sample Showdown
                </button>
              </div>
            ) : (
              <div className="pk-duellog-watch-view">
                {/* Replay Controls Bar */}
                <div className="pk-duellog-controls-bar">
                  <div className="pk-duellog-ctrl-group">
                    <button type="button" className="pk-duellog-ctrl-btn pk-btn-restart" title="Restart" onClick={handleRestart}>
                      ↺
                    </button>
                    <button
                      type="button"
                      className="pk-duellog-ctrl-btn pk-btn-prev"
                      title="Previous"
                      disabled={currentReplayIndex <= 0}
                      onClick={handlePrev}
                    >
                      ◀
                    </button>
                    <button type="button" className="pk-duellog-ctrl-btn pk-duellog-play-btn" onClick={handleTogglePlay}>
                      {isAutoPlaying ? '⏸ PAUSE' : '▶ PLAY'}
                    </button>
                    <button
                      type="button"
                      className="pk-duellog-ctrl-btn pk-btn-next"
                      title="Next"
                      disabled={currentReplayIndex >= entries.length - 1}
                      onClick={handleNext}
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className="pk-duellog-ctrl-btn pk-btn-speed"
                      onClick={() => setPlaybackSpeed(playbackSpeed === 1 ? 2 : 1)}
                    >
                      {playbackSpeed}x
                    </button>
                  </div>
                  <div className="pk-duellog-counter-badge">
                    <span className="pk-current-step">{currentReplayIndex + 1}</span> of{' '}
                    <span className="pk-total-steps">{entries.length}</span>
                  </div>
                </div>

                {/* Progress Timeline */}
                <div className="pk-duellog-timeline">
                  <div className="pk-duellog-timeline-bar" style={{ width: `${progressPercent}%` }} />
                </div>

                {/* Arena Display */}
                {currentEntry && (
                  <div className="pk-duellog-arena-container">
                    <div className="pk-clash-arena">
                      {/* Fighter 1 */}
                      <div
                        className={`pk-fighter-card ${
                          currentEntry.result === 'tie'
                            ? 'tie'
                            : currentEntry.winnerId === currentEntry.player1.id
                            ? 'winner'
                            : 'loser'
                        }`}
                      >
                        <div className="pk-fighter-badge">
                          {currentEntry.winnerId === currentEntry.player1.id
                            ? '🏆 WINNER'
                            : currentEntry.result === 'tie'
                            ? '🤝 TIE'
                            : 'DEFEATED'}
                        </div>
                        <div className="pk-fighter-avatar">👤</div>
                        <div className="pk-fighter-name">{currentEntry.player1.name}</div>
                        <div className="pk-fighter-weapon-box">
                          <div className="pk-fighter-weapon-emoji">{RPS_EMOJIS[currentEntry.player1.choice] || '🪨'}</div>
                          <div className="pk-fighter-weapon-title">{RPS_TITLES[currentEntry.player1.choice] || 'WEAPON'}</div>
                        </div>
                      </div>

                      {/* Center Emblem */}
                      <div className="pk-clash-center">
                        <div className="pk-clash-round-tag">
                          Round {currentEntry.round} · Clash #{currentEntry.clashNumber}
                        </div>
                        <div className="pk-clash-vs-emblem">{currentEntry.result === 'tie' ? '🤝' : '⚔️'}</div>
                        <div
                          className={`pk-clash-verdict-tag ${
                            currentEntry.result === 'tie' ? 'verdict-tie' : 'verdict-win'
                          }`}
                        >
                          {currentEntry.result === 'tie' ? 'STALEMATE' : `${currentEntry.winnerName ?? 'VICTORY'} WINS!`}
                        </div>
                      </div>

                      {/* Fighter 2 */}
                      <div
                        className={`pk-fighter-card ${
                          currentEntry.result === 'tie'
                            ? 'tie'
                            : currentEntry.winnerId === currentEntry.player2.id
                            ? 'winner'
                            : 'loser'
                        }`}
                      >
                        <div className="pk-fighter-badge">
                          {currentEntry.winnerId === currentEntry.player2.id
                            ? '🏆 WINNER'
                            : currentEntry.result === 'tie'
                            ? '🤝 TIE'
                            : 'DEFEATED'}
                        </div>
                        <div className="pk-fighter-avatar">🤖</div>
                        <div className="pk-fighter-name">{currentEntry.player2.name}</div>
                        <div className="pk-fighter-weapon-box">
                          <div className="pk-fighter-weapon-emoji">{RPS_EMOJIS[currentEntry.player2.choice] || '🪨'}</div>
                          <div className="pk-fighter-weapon-title">{RPS_TITLES[currentEntry.player2.choice] || 'WEAPON'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Narrative Log Ticker */}
                <div className="pk-duellog-narrative-box">
                  <span className="pk-narrative-tag">COMMENTARY LOG</span>
                  <div className="pk-narrative-text">{currentEntry?.narrative ?? 'Loading clash...'}</div>
                </div>
              </div>
            )
          ) : (
            <div className="pk-duellog-summary-view">
              {/* Stat KPI Chips */}
              <div className="pk-duellog-kpi-grid">
                <div className="pk-duellog-kpi-card">
                  <div className="pk-kpi-value">{stats.totalClashes}</div>
                  <div className="pk-kpi-label">Total Clashes</div>
                </div>
                <div className="pk-duellog-kpi-card kpi-win">
                  <div className="pk-kpi-value">{stats.totalDecisiveWins}</div>
                  <div className="pk-kpi-label">Decisive Wins</div>
                </div>
                <div className="pk-duellog-kpi-card kpi-tie">
                  <div className="pk-kpi-value">{stats.totalTies}</div>
                  <div className="pk-kpi-label">Stalemate Ties</div>
                </div>
                <div className="pk-duellog-kpi-card kpi-fav">
                  <div className="pk-kpi-value">{stats.mostFavoredChoice.toUpperCase()}</div>
                  <div className="pk-kpi-label">Dominant Weapon</div>
                </div>
              </div>

              {/* Action bar */}
              <div className="pk-duellog-summary-actions">
                <span className="pk-duellog-format-hint">📄 Formatted Text Audit Log ({entries.length} entries)</span>
                <button type="button" className="pk-btn-subtle pk-btn-copy-log" onClick={handleCopy}>
                  {copied ? '✅ COPIED TO CLIPBOARD!' : '📋 COPY LOG TO CLIPBOARD'}
                </button>
              </div>

              {/* Formatted Text */}
              <div className="pk-duellog-text-wrapper">
                <pre className="pk-duellog-pre">{duelLogManager.generateFormattedTextSummary(entries)}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pk-duellog-footer">
          <div className="pk-duellog-footer-left">
            <button
              type="button"
              className="pk-btn-subtle pk-duellog-filter-btn"
              title="Toggle filter"
              onClick={handleToggleFilter}
            >
              {sourceFilter === 'current'
                ? '🔍 Filter: Match Only'
                : sourceFilter === 'recent'
                ? '🔍 Filter: Recent History'
                : '🔍 All Outcomes'}
            </button>
          </div>
          <button type="button" className="pk-btn-primary pk-duellog-back-btn" onClick={onClose}>
            ⬅️ BACK TO RESULTS
          </button>
        </div>
      </div>
    </div>
  );
};
