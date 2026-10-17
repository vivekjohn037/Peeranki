import React, { useState, useEffect } from 'react';
import { PeerankiAudio } from '../audio/PeerankiAudio';

interface HowToPlayModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'towers' | 'weapons' | 'duels' | 'rules';
}

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'towers',
}) => {
  const [activeTab, setActiveTab] = useState<'towers' | 'weapons' | 'duels' | 'rules'>(defaultTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      PeerankiAudio.effect('select');
    }
  }, [isOpen, defaultTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTabChange = (tab: 'towers' | 'weapons' | 'duels' | 'rules') => {
    PeerankiAudio.effect('select');
    setActiveTab(tab);
  };

  const handleClose = () => {
    PeerankiAudio.effect('click');
    onClose();
  };

  return (
    <div
      className="pk-modal-backdrop pk-howtoplay-backdrop"
      style={{ display: 'flex' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="pk-howtoplay-dialog">
        <div className="pk-htp-header">
          <div className="pk-htp-title-group">
            <span className="pk-htp-icon" aria-hidden="true">📖</span>
            <div>
              <h2 className="pk-htp-title">HOW TO PLAY PEERANKI</h2>
              <div className="pk-htp-subtitle">Traditional Kerala Strategy Game Guide</div>
            </div>
          </div>
          <button type="button" className="pk-htp-close-btn" aria-label="Close Guide" onClick={handleClose}>
            ✕
          </button>
        </div>

        <div className="pk-htp-tabs">
          <button
            type="button"
            className={`pk-htp-tab ${activeTab === 'towers' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('towers')}
          >
            <span>🏰</span> Towers & Stages
          </button>
          <button
            type="button"
            className={`pk-htp-tab ${activeTab === 'weapons' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('weapons')}
          >
            <span>⚔️</span> Weapons Arsenal
          </button>
          <button
            type="button"
            className={`pk-htp-tab ${activeTab === 'duels' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('duels')}
          >
            <span>✊</span> RPS Duels
          </button>
          <button
            type="button"
            className={`pk-htp-tab ${activeTab === 'rules' ? 'is-active' : ''}`}
            onClick={() => handleTabChange('rules')}
          >
            <span>📜</span> Match Flow
          </button>
        </div>

        <div className="pk-htp-body">
          {activeTab === 'towers' && (
            <div className="pk-htp-section">
              <h3 className="pk-htp-section-title">Tower Destruction Stages</h3>
              <p className="pk-htp-desc">
                Every player controls a traditional Kerala fortress tower. When hit by standard weapons, your tower gradually splinters and crumbles until total elimination.
              </p>

              <div className="pk-htp-tower-stages-grid">
                <div className="pk-htp-stage-card">
                  <div className="pk-htp-img-wrap">
                    <img src="assets/towers/tower_big.png" alt="Stage 0 - Big Tower" />
                  </div>
                  <div className="pk-htp-stage-name">Stage 1: Big Tower</div>
                  <div className="pk-htp-stage-hp">3 HP (Full Fort)</div>
                  <p className="pk-htp-stage-desc">Unbroken triple fortress. Strongest stance at round start.</p>
                </div>

                <div className="pk-htp-stage-arrow">➔</div>

                <div className="pk-htp-stage-card">
                  <div className="pk-htp-img-wrap">
                    <img src="assets/towers/tower_small.png" alt="Stage 1 - Split Towers" />
                  </div>
                  <div className="pk-htp-stage-name">Stage 2: Split Towers</div>
                  <div className="pk-htp-stage-hp">2 HP (Damaged)</div>
                  <p className="pk-htp-stage-desc">Split into two smaller watchtowers after the first Gun strike.</p>
                </div>

                <div className="pk-htp-stage-arrow">➔</div>

                <div className="pk-htp-stage-card">
                  <div className="pk-htp-img-wrap">
                    <img src="assets/towers/tower_one.png" alt="Stage 2 - Lone Tower" />
                  </div>
                  <div className="pk-htp-stage-name">Stage 3: Lone Tower</div>
                  <div className="pk-htp-stage-hp">1 HP (Critical)</div>
                  <p className="pk-htp-stage-desc">Single spire remaining. One more direct hit causes collapse!</p>
                </div>

                <div className="pk-htp-stage-arrow">➔</div>

                <div className="pk-htp-stage-card is-destroyed">
                  <div className="pk-htp-img-wrap">
                    <img src="assets/towers/tower_destroyed.png" alt="Stage 3 - Destroyed Tower" />
                  </div>
                  <div className="pk-htp-stage-name">Stage 4: Destroyed</div>
                  <div className="pk-htp-stage-hp">0 HP (Eliminated)</div>
                  <p className="pk-htp-stage-desc">Fortress in ruins. Player eliminated from active shooting.</p>
                </div>
              </div>

              <div className="pk-htp-tip-box">
                <span className="pk-htp-tip-icon">💡</span>
                <div>
                  <strong>Pro Tip:</strong> Heavy weapons like <strong>⚡ Peeranki</strong> bypass stage-by-stage chipping and instantly crush an unshielded tower to rubble in a single shot!
                </div>
              </div>
            </div>
          )}

          {activeTab === 'weapons' && (
            <div className="pk-htp-section">
              <h3 className="pk-htp-section-title">The 5 Tactical Weapons</h3>
              <p className="pk-htp-desc">
                Weapons are unlocked round-by-round in strict Kerala festival order. Master weapon strengths and strategic counters to outmaneuver rivals!
              </p>

              <div className="pk-htp-weapons-list">
                <div className="pk-htp-weapon-row">
                  <div className="pk-htp-w-icon">
                    <img src="assets/weapons/gun.png" alt="Gun" />
                  </div>
                  <div className="pk-htp-w-details">
                    <div className="pk-htp-w-header">
                      <span className="pk-htp-w-name">🔫 Gun (തോക്ക്)</span>
                      <span className="pk-htp-w-badge tier-1">Tier 1 • Starter</span>
                    </div>
                    <p className="pk-htp-w-text">
                      Standard single shot weapon. Reduces target tower by 1 stage. Blocked and absorbed completely by an active Shield.
                    </p>
                  </div>
                </div>

                <div className="pk-htp-weapon-row">
                  <div className="pk-htp-w-icon">
                    <img src="assets/weapons/peeranki.png" alt="Peeranki" />
                  </div>
                  <div className="pk-htp-w-details">
                    <div className="pk-htp-w-header">
                      <span className="pk-htp-w-name">⚡ Peeranki (പീരങ്കി Cannon)</span>
                      <span className="pk-htp-w-badge tier-2">Tier 2 • Heavy Artillery</span>
                    </div>
                    <p className="pk-htp-w-text">
                      Heavy festival cannon shot. Instantly destroys any unshielded tower! If the target has a shield, cracks and disables it for the entire round.
                    </p>
                  </div>
                </div>

                <div className="pk-htp-weapon-row">
                  <div className="pk-htp-w-icon">
                    <img src="assets/weapons/shield.png" alt="Shield" />
                  </div>
                  <div className="pk-htp-w-details">
                    <div className="pk-htp-w-header">
                      <span className="pk-htp-w-name">🛡️ Shield (പരിച)</span>
                      <span className="pk-htp-w-badge tier-3">Tier 3 • Passive Fortification</span>
                    </div>
                    <p className="pk-htp-w-text">
                      Passive defense barrier automatically active on your fortress. Absorbs incoming Gun shots with zero damage taken. Vulnerable to Hook and heavy Peeranki.
                    </p>
                  </div>
                </div>

                <div className="pk-htp-weapon-row">
                  <div className="pk-htp-w-icon">
                    <img src="assets/weapons/hook.png" alt="Hook" />
                  </div>
                  <div className="pk-htp-w-details">
                    <div className="pk-htp-w-header">
                      <span className="pk-htp-w-name">🪝 Hook (കൊളുത്ത്)</span>
                      <span className="pk-htp-w-badge tier-4">Tier 4 • Shield Breaker</span>
                    </div>
                    <p className="pk-htp-w-text">
                      Specialized siege grappling tool. Strips and permanently destroys an opponent's Shield for the rest of the game, leaving them vulnerable to cannon strikes!
                    </p>
                  </div>
                </div>

                <div className="pk-htp-weapon-row">
                  <div className="pk-htp-w-icon">
                    <img src="assets/weapons/double_peeranki.png" alt="Double Peeranki" />
                  </div>
                  <div className="pk-htp-w-details">
                    <div className="pk-htp-w-header">
                      <span className="pk-htp-w-name">💥 Double Peeranki (ഇരട്ട പീരങ്കി)</span>
                      <span className="pk-htp-w-badge tier-5">Tier 5 • Ultimate</span>
                    </div>
                    <p className="pk-htp-w-text">
                      Supreme artillery! Fires dual cannonballs at two distinct opponents in the same turn. Devastating crowd control in multiplayer arenas.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'duels' && (
            <div className="pk-htp-section">
              <h3 className="pk-htp-section-title">Rock-Paper-Scissors Duels (RPS)</h3>
              <p className="pk-htp-desc">
                When combat narrows down to the <strong>final 2 standing fortresses</strong> in a round, the battle enters an epic showdown duel!
              </p>

              <div className="pk-htp-duel-diagram">
                <div className="pk-htp-rps-card">
                  <div className="pk-htp-rps-emoji">🪨</div>
                  <div className="pk-htp-rps-title">ROCK</div>
                  <div className="pk-htp-rps-beats">Beats ✂️ Scissors</div>
                </div>

                <div className="pk-htp-duel-vs">⚔️</div>

                <div className="pk-htp-rps-card">
                  <div className="pk-htp-rps-emoji">📄</div>
                  <div className="pk-htp-rps-title">PAPER</div>
                  <div className="pk-htp-rps-beats">Beats 🪨 Rock</div>
                </div>

                <div className="pk-htp-duel-vs">⚔️</div>

                <div className="pk-htp-rps-card">
                  <div className="pk-htp-rps-emoji">✂️</div>
                  <div className="pk-htp-rps-title">SCISSORS</div>
                  <div className="pk-htp-rps-beats">Beats 📄 Paper</div>
                </div>
              </div>

              <div className="pk-htp-duel-rules-box">
                <div className="pk-htp-rule-item">
                  <span className="pk-htp-bullet">1.</span>
                  <span>Both finalists pick Rock, Paper, or Scissors before the duel timer expires.</span>
                </div>
                <div className="pk-htp-rule-item">
                  <span className="pk-htp-bullet">2.</span>
                  <span>If both pick the same hand, it's a <strong>Tie</strong> and the duel repeats immediately!</span>
                </div>
                <div className="pk-htp-rule-item">
                  <span className="pk-htp-bullet">3.</span>
                  <span>The winner takes the <strong>Round Victory</strong> and unlocks the next weapon in progression!</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="pk-htp-section">
              <h3 className="pk-htp-section-title">Turn Cycle & Winning Conditions</h3>
              <p className="pk-htp-desc">
                Peeranki matches combine rhythmic Kerala counting, tactical shooting, and tournament points.
              </p>

              <div className="pk-htp-flow-steps">
                <div className="pk-htp-step">
                  <div className="pk-htp-step-num">1</div>
                  <div className="pk-htp-step-content">
                    <h4>The Count (കൗണ്ടിംഗ്)</h4>
                    <p>A count moves sequentially from tower to tower (up to 10). The player on whom the count lands becomes the active shooter.</p>
                  </div>
                </div>

                <div className="pk-htp-step">
                  <div className="pk-htp-step-num">2</div>
                  <div className="pk-htp-step-content">
                    <h4>Shooting Turn</h4>
                    <p>When it is your turn, select an owned weapon from the bottom arsenal, then click on any enemy tower to fire. You have a 10-second action timer.</p>
                  </div>
                </div>

                <div className="pk-htp-step">
                  <div className="pk-htp-step-num">3</div>
                  <div className="pk-htp-step-content">
                    <h4>Round Winner & Weapon Upgrade</h4>
                    <p>The last surviving player or the duel winner earns a new weapon in the progression: Gun ➔ Peeranki ➔ Shield ➔ Hook ➔ Double Peeranki.</p>
                  </div>
                </div>

                <div className="pk-htp-step">
                  <div className="pk-htp-step-num">4</div>
                  <div className="pk-htp-step-content">
                    <h4>Winning the Match</h4>
                    <p>Be the first player to collect all 5 weapons, or hold the highest score and most weapons when the match duration clock expires!</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="pk-htp-footer">
          <button type="button" className="pk-btn-primary pk-htp-confirm-btn" onClick={handleClose}>
            GOT IT, LET'S PLAY!
          </button>
        </div>
      </div>
    </div>
  );
};
