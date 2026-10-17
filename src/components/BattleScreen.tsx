import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { WeaponType, RpsChoice } from '../game/rules';
import {
  ACTIVE_WEAPONS,
  findMatchWinners,
  getCountedPlayerIndex,
  getNextCountingStartIndex,
  nextWeaponUpgrade,
  resolveRpsWinner,
} from '../game/rules';
import {
  chooseBotAction,
  resolvePlayerAction,
  playResolutionSoundEffects,
  soundEffectManager,
} from '../game/engine';
import { duelLogManager } from '../game/DuelLogManager';
import { getAvatarDef, type AnimalAvatarId } from '../game/avatars';
import { PeerankiAudio } from '../audio/PeerankiAudio';

export interface BattlePlayer {
  id: number;
  name: string;
  avatar: AnimalAvatarId;
  stage: number; // 0: Big, 1: Split, 2: Lone, 3: Eliminated
  alive: boolean;
  connected: boolean;
  weapons: WeaponType[];
  eliminationPoints: number;
  shieldDisabledRound: number;
  isBot: boolean;
}

interface BattleScreenProps {
  initialPlayers: BattlePlayer[];
  localPlayerId: number;
  matchDurationMinutes: number;
  isOnline: boolean;
  roomCode?: string;
  onLeaveMatch: () => void;
  onOpenGuide: () => void;
  onOpenDuelLog: () => void;
}

const STAGE_NAMES = ['Big Tower', 'Two Small Towers', 'One Tower', 'Eliminated'];
const TOWER_IMAGES = [
  '/assets/towers/tower_big.png',
  '/assets/towers/tower_small.png',
  '/assets/towers/tower_one.png',
  '/assets/towers/tower_destroyed.png',
];

const WEAPON_INFO: Record<WeaponType, { label: string; icon: string; desc: string }> = {
  gun: { label: 'Gun', icon: '/assets/weapons/gun.png', desc: 'Standard single shot' },
  peeranki: { label: 'Peeranki', icon: '/assets/weapons/peeranki.png', desc: 'Heavy cannon shot' },
  shield: { label: 'Shield', icon: '/assets/weapons/shield.png', desc: 'Passive protection' },
  hook: { label: 'Hook', icon: '/assets/weapons/hook.png', desc: 'Disables opponent shield' },
  doublePeeranki: { label: 'Double Peeranki', icon: '/assets/weapons/double_peeranki.png', desc: 'Fires at two opponents' },
};

const RPS_CHOICES: { id: RpsChoice; label: string; emoji: string }[] = [
  { id: 'rock', label: 'Rock', emoji: '🪨' },
  { id: 'paper', label: 'Paper', emoji: '📄' },
  { id: 'scissors', label: 'Scissors', emoji: '✂️' },
];

export const BattleScreen: React.FC<BattleScreenProps> = ({
  initialPlayers,
  localPlayerId,
  matchDurationMinutes,
  isOnline,
  roomCode,
  onLeaveMatch,
  onOpenGuide,
  onOpenDuelLog,
}) => {
  const [players, setPlayers] = useState<BattlePlayer[]>(initialPlayers);
  const [phase, setPhase] = useState<'counting' | 'shooting' | 'duel' | 'gameover'>('counting');
  const [round, setRound] = useState(1);
  const [remainingSeconds, setRemainingSeconds] = useState(matchDurationMinutes * 60);
  const [countNumber, setCountNumber] = useState(0);
  const [currentShooterIndex, setCurrentShooterIndex] = useState(-1);
  const [countingStartIndex, setCountingStartIndex] = useState(0);
  const [selectedWeapon, setSelectedWeapon] = useState<WeaponType>('gun');
  const [pendingDoubleTargetIndex, setPendingDoubleTargetIndex] = useState(-1);
  const [statusMessage, setStatusMessage] = useState('Round 1: Preparing Kerala Counting...');
  const [actionSecondsLeft, setActionSecondsLeft] = useState(10);
  const [flashingTargetIndex, setFlashingTargetIndex] = useState(-1);
  const [flashingLocalDamage, setFlashingLocalDamage] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(PeerankiAudio.isMuted());

  // RPS Duel state
  const [duelState, setDuelState] = useState<{
    active: boolean;
    round: number;
    fighter1: BattlePlayer;
    fighter2: BattlePlayer;
    myChoice: RpsChoice | null;
    opponentChoice: RpsChoice | null;
    opponentSubmitted: boolean;
    resultMessage: string;
  } | null>(null);

  // Game over state
  const [gameOverWinners, setGameOverWinners] = useState<BattlePlayer[]>([]);

  // Refs for loop controls
  const playersRef = useRef(players);
  playersRef.current = players;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const roundRef = useRef(round);
  roundRef.current = round;
  const currentShooterRef = useRef(currentShooterIndex);
  currentShooterRef.current = currentShooterIndex;
  const countingStartRef = useRef(countingStartIndex);
  countingStartRef.current = countingStartIndex;
  const pendingDoubleRef = useRef(pendingDoubleTargetIndex);
  pendingDoubleRef.current = pendingDoubleTargetIndex;
  const selectedWeaponRef = useRef(selectedWeapon);
  selectedWeaponRef.current = selectedWeapon;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2800);
  }, []);

  const triggerDamageFlash = useCallback((targetIndex: number) => {
    setFlashingTargetIndex(targetIndex);
    if (playersRef.current[targetIndex]?.id === localPlayerId) {
      setFlashingLocalDamage(true);
      setTimeout(() => setFlashingLocalDamage(false), 280);
    }
    setTimeout(() => setFlashingTargetIndex(-1), 220);
  }, [localPlayerId]);

  // Overall Match Timer Countdown
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          triggerMatchOver('Timer Expired!');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Action Timer (10s for shooter)
  useEffect(() => {
    let timer: number | undefined;
    if (phase === 'shooting') {
      setActionSecondsLeft(10);
      timer = window.setInterval(() => {
        setActionSecondsLeft((prev) => {
          if (prev <= 1) {
            window.clearInterval(timer);
            handleShootingTimeout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [phase, currentShooterIndex]);

  // Trigger Match Over
  const triggerMatchOver = (reason = '') => {
    setPhase('gameover');
    const winners = findMatchWinners(playersRef.current);
    setGameOverWinners(winners);
    const names = winners.map((w) => w.name).join(' & ');
    setStatusMessage(`🏆 MATCH COMPLETED! ${names} won the battle! ${reason}`);
    soundEffectManager.playMatchVictory();
  };

  // Start a new Round
  const startNextRound = useCallback((nextRoundNum: number, nextStartIndex = 0) => {
    setRound(nextRoundNum);
    setCountingStartIndex(nextStartIndex);
    setCountNumber(0);
    setCurrentShooterIndex(-1);
    setPendingDoubleTargetIndex(-1);
    setPhase('counting');
    setStatusMessage(`Round ${nextRoundNum}: Counting in progress...`);

    // Reset round-specific shield disabled states
    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        shieldDisabledRound: -1,
      })),
    );

    // Kerala count loop
    let currentStep = 1;
    const interval = window.setInterval(() => {
      setCountNumber(currentStep);
      soundEffectManager.playClip('timer_tick');

      if (currentStep >= 10) {
        window.clearInterval(interval);
        // Counting lands on 10!
        const shooterIdx = getCountedPlayerIndex(playersRef.current, nextStartIndex, 10);
        if (shooterIdx >= 0 && playersRef.current[shooterIdx]?.alive) {
          setCurrentShooterIndex(shooterIdx);
          soundEffectManager.playClip('shooter_selected');
          const shooter = playersRef.current[shooterIdx];
          setStatusMessage(`🎯 Count lands on ${shooter.name}! Time to shoot!`);

          // Default selected weapon to gun, or first available
          const owned = shooter.weapons.filter((w) => w !== 'shield');
          setSelectedWeapon(owned[0] || 'gun');
          setPhase('shooting');
        } else {
          // Fallback to living player
          const living = playersRef.current.findIndex((p) => p.alive && p.connected);
          setCurrentShooterIndex(living);
          setPhase('shooting');
        }
      }
      currentStep++;
    }, 220);
  }, []);

  // Initialize first round
  useEffect(() => {
    startNextRound(1, 0);
  }, [startNextRound]);

  // Check if Bot shooter needs to act
  useEffect(() => {
    let botTimer: number | undefined;
    if (phase === 'shooting' && currentShooterIndex >= 0) {
      const shooter = players[currentShooterIndex];
      if (shooter && shooter.isBot && shooter.alive) {
        // Bot thinks for 1.2s then fires
        botTimer = window.setTimeout(() => {
          executeBotShot(currentShooterIndex);
        }, 1200);
      }
    }
    return () => {
      if (botTimer) window.clearTimeout(botTimer);
    };
  }, [phase, currentShooterIndex]);

  // Execute Bot Shot
  const executeBotShot = (botIndex: number) => {
    const action = chooseBotAction(playersRef.current, botIndex, roundRef.current);
    if (!action) {
      handleShootingTimeout();
      return;
    }
    applyAction(action);
  };

  // Handle Timeout
  const handleShootingTimeout = () => {
    setStatusMessage('⏱️ Action timeout! Passing turn...');
    checkRoundProgression(currentShooterRef.current);
  };

  // Apply action from Human or Bot
  const applyAction = (action: { shooterId: number; weapon: WeaponType; targetIds: number[] }) => {
    const currentList = structuredClone(playersRef.current);
    const resolution = resolvePlayerAction(currentList, action, currentShooterRef.current, roundRef.current);

    if (!resolution.accepted) {
      showToast('❌ Invalid target selection!');
      return;
    }

    // Play sounds
    playResolutionSoundEffects(action, resolution);

    // Flash hit targets
    resolution.hits.forEach((hit) => {
      triggerDamageFlash(hit.targetIndex);
    });

    const shooter = currentList[resolution.shooterIndex];
    const hitDescriptions = resolution.hits.map((h) => {
      const target = currentList[h.targetIndex];
      if (h.eliminated) return `${target.name} was ELIMINATED!`;
      if (h.shieldRemoved) return `${target.name}'s Shield was permanently stripped!`;
      if (h.action === 'shield_absorbed') return `${target.name}'s Shield absorbed the shot!`;
      if (h.action === 'shield_destroyed_for_round') return `${target.name}'s Shield was shattered for this round!`;
      return `${target.name}'s tower took damage (${STAGE_NAMES[target.stage]})!`;
    });

    setStatusMessage(`🎯 ${shooter.name} fired ${WEAPON_INFO[action.weapon].label}! ${hitDescriptions.join(' ')}`);
    setPlayers(currentList);
    setPendingDoubleTargetIndex(-1);

    // Check living players
    setTimeout(() => {
      checkRoundProgression(resolution.lastTargetIndex);
    }, 1400);
  };

  // Check Round Progression / Duels / End
  const checkRoundProgression = (lastTargetIndex: number) => {
    const living = playersRef.current.filter((p) => p.alive && p.connected);

    // 1. Only 1 player alive -> Winner of the match or round!
    if (living.length <= 1) {
      triggerMatchOver(living[0] ? `${living[0].name} is the last tower standing!` : '');
      return;
    }

    // 2. Exactly 2 players alive -> SUDDEN DEATH RPS DUEL!
    if (living.length === 2) {
      startDuel(living[0], living[1]);
      return;
    }

    // 3. More than 2 players -> Next counting cycle!
    const nextStartIndex = getNextCountingStartIndex(playersRef.current, lastTargetIndex);
    startNextRound(roundRef.current + 1, nextStartIndex);
  };

  // Start RPS Duel
  const startDuel = (p1: BattlePlayer, p2: BattlePlayer) => {
    setPhase('duel');
    soundEffectManager.playDuelStart();
    setStatusMessage('⚔️ SHOWDOWN! Only 2 fortresses stand! Rock–Paper–Scissors Duel!');

    setDuelState({
      active: true,
      round: 1,
      fighter1: p1,
      fighter2: p2,
      myChoice: null,
      opponentChoice: null,
      opponentSubmitted: false,
      resultMessage: 'Both players choose your weapon!',
    });

    // If opponent is bot, plan bot choice
    if (p2.isBot) {
      setTimeout(() => {
        setDuelState((prev) => (prev ? { ...prev, opponentSubmitted: true } : null));
      }, 1000);
    }
  };

  // Handle Human Submitting RPS choice
  const handleDuelChoice = (choice: RpsChoice) => {
    if (!duelState || duelState.myChoice) return;

    PeerankiAudio.effect('click');
    const botChoices: RpsChoice[] = ['rock', 'paper', 'scissors'];
    const botChoice = botChoices[Math.floor(Math.random() * 3)];

    setDuelState((prev) =>
      prev
        ? {
            ...prev,
            myChoice: choice,
            opponentChoice: botChoice,
            opponentSubmitted: true,
          }
        : null,
    );

    // Reveal clash after short delay
    setTimeout(() => {
      resolveDuelShowdown(choice, botChoice);
    }, 900);
  };

  // Resolve RPS Showdown
  const resolveDuelShowdown = (c1: RpsChoice, c2: RpsChoice) => {
    if (!duelState) return;

    const winnerResult = resolveRpsWinner(c1, c2);

    if (winnerResult === 'tie') {
      soundEffectManager.playDuelTie();
      setDuelState((prev) =>
        prev
          ? {
              ...prev,
              resultMessage: '🤝 Tie showdown! Clashing again...',
            }
          : null,
      );

      // Record tie
      duelLogManager.recordDuelOutcome({
        round: roundRef.current,
        clashNumber: duelState.round,
        player1: { id: duelState.fighter1.id, name: duelState.fighter1.name, choice: c1 },
        player2: { id: duelState.fighter2.id, name: duelState.fighter2.name, choice: c2 },
        result: 'tie',
      });

      setTimeout(() => {
        setDuelState((prev) =>
          prev
            ? {
                ...prev,
                round: prev.round + 1,
                myChoice: null,
                opponentChoice: null,
                opponentSubmitted: duelState.fighter2.isBot,
                resultMessage: 'Choose again!',
              }
            : null,
        );
      }, 1400);
      return;
    }

    // Decisive win
    soundEffectManager.playDuelWin();
    const isP1Winner = winnerResult === 'first';
    const victor = isP1Winner ? duelState.fighter1 : duelState.fighter2;
    const loser = isP1Winner ? duelState.fighter2 : duelState.fighter1;

    setDuelState((prev) =>
      prev
        ? {
            ...prev,
            resultMessage: `🏆 ${victor.name} wins the duel!`,
          }
        : null,
    );

    // Record outcome
    duelLogManager.recordDuelOutcome({
      round: roundRef.current,
      clashNumber: duelState.round,
      player1: { id: duelState.fighter1.id, name: duelState.fighter1.name, choice: c1 },
      player2: { id: duelState.fighter2.id, name: duelState.fighter2.name, choice: c2 },
      result: 'win',
      winnerId: victor.id,
      winnerName: victor.name,
      winnerChoice: isP1Winner ? c1 : c2,
      loserId: loser.id,
      loserName: loser.name,
      loserChoice: isP1Winner ? c2 : c1,
    });

    // Update victor weapon progression
    setTimeout(() => {
      setDuelState(null);
      const currentList = structuredClone(playersRef.current);
      const victorIdx = currentList.findIndex((p) => p.id === victor.id);
      const loserIdx = currentList.findIndex((p) => p.id === loser.id);

      if (loserIdx >= 0) {
        currentList[loserIdx].stage = 3;
        currentList[loserIdx].alive = false;
      }

      if (victorIdx >= 0) {
        const upgrade = nextWeaponUpgrade(currentList[victorIdx].weapons, roundRef.current);
        if (upgrade && !currentList[victorIdx].weapons.includes(upgrade)) {
          currentList[victorIdx].weapons.push(upgrade);
          soundEffectManager.playRoundWin();
          showToast(`🎁 ${victor.name} unlocked ${WEAPON_INFO[upgrade]?.label ?? upgrade}!`);
        }
        currentList[victorIdx].eliminationPoints += 1;
      }

      setPlayers(currentList);
      triggerMatchOver(`${victor.name} conquered the final duel!`);
    }, 1800);
  };

  // Human Target Click
  const handlePlayerCardClick = (targetIndex: number) => {
    if (phase !== 'shooting') return;
    if (currentShooterIndex !== localPlayerIndex) {
      showToast('⏳ Wait for your turn to shoot!');
      return;
    }

    const target = players[targetIndex];
    if (!target.alive || !target.connected) {
      showToast('❌ Target is already eliminated!');
      return;
    }
    if (targetIndex === localPlayerIndex) {
      showToast('❌ You cannot shoot yourself!');
      return;
    }

    const currentWeapon = selectedWeaponRef.current;

    // Handle Double Peeranki (needs 2 distinct targets)
    if (currentWeapon === 'doublePeeranki') {
      if (pendingDoubleTargetIndex < 0) {
        setPendingDoubleTargetIndex(targetIndex);
        showToast('💥 1st target selected! Click a 2nd target.');
        return;
      }
      if (pendingDoubleTargetIndex === targetIndex) {
        showToast('❌ Choose a DIFFERENT 2nd target!');
        return;
      }
      // Both targets chosen
      applyAction({
        shooterId: localPlayerId,
        weapon: 'doublePeeranki',
        targetIds: [players[pendingDoubleTargetIndex].id, target.id],
      });
      return;
    }

    // Single Target Weapon
    if (currentWeapon === 'hook' && !target.weapons.includes('shield')) {
      showToast('⚠️ Target has no Shield to hook!');
      return;
    }

    applyAction({
      shooterId: localPlayerId,
      weapon: currentWeapon,
      targetIds: [target.id],
    });
  };

  // Cycle Weapon
  const handleCycleWeapon = (dir: 1 | -1) => {
    const shooter = players[localPlayerIndex];
    if (!shooter) return;
    const available = shooter.weapons.filter((w) => w !== 'shield' && ACTIVE_WEAPONS.includes(w));
    if (available.length === 0) return;

    PeerankiAudio.effect('click');
    const idx = available.indexOf(selectedWeapon);
    const nextIdx = (idx + dir + available.length) % available.length;
    setSelectedWeapon(available[nextIdx]);
    setPendingDoubleTargetIndex(-1);
  };

  // Keyboard shortcut targeting (1-9)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= players.length) {
        handlePlayerCardClick(num - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [players, phase, currentShooterIndex, pendingDoubleTargetIndex]);

  const [windowDimensions, setWindowDimensions] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 800,
    height: typeof window !== 'undefined' ? window.innerHeight : 600,
    isPortrait: typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false,
  }));

  useEffect(() => {
    const onResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
        isPortrait: window.innerHeight > window.innerWidth,
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const getBoardGridLayout = (count: number, isPortrait: boolean, width: number) => {
    if (isPortrait) {
      if (count <= 2) return { cols: 1, rows: 2 };
      if (count <= 4) return { cols: 2, rows: 2 };
      if (count <= 6) return { cols: 2, rows: 3 };
      if (count <= 8) return { cols: 2, rows: 4 };
      return { cols: width > 420 ? 3 : 2, rows: width > 420 ? 4 : 5 };
    } else {
      if (count <= 4) return { cols: count, rows: 1 };
      if (count === 5) return { cols: 5, rows: 1 };
      if (count === 6) return { cols: 3, rows: 2 };
      if (count <= 8) return { cols: 4, rows: 2 };
      return { cols: 5, rows: 2 };
    }
  };

  const gridLayout = getBoardGridLayout(players.length, windowDimensions.isPortrait, windowDimensions.width);
  const isCompactGrid = gridLayout.rows >= 3 || players.length >= 6 || windowDimensions.height < 650;

  const localPlayerIndex = players.findIndex((p) => p.id === localPlayerId);
  const isMyTurn = phase === 'shooting' && currentShooterIndex === localPlayerIndex;
  const localPlayer = players[localPlayerIndex];
  const activeWeaponsList: WeaponType[] = localPlayer
    ? localPlayer.weapons.filter((w): w is WeaponType => w !== 'shield' && w in WEAPON_INFO)
    : ['gun'];

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const timeDisplay = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div
      id="game-ui-root"
      className={`pk-orientation-${windowDimensions.isPortrait ? 'portrait' : 'landscape'} pk-count-${players.length}`}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Damage Screen Vignette Flash */}
      {flashingLocalDamage && <div className="pk-damage-vignette" />}

      {/* Floating HUD Toast Notification */}
      {toastMessage && (
        <div className="pk-hud-toast-container">
          <div className="pk-hud-toast pk-toast-info">
            <span>ℹ️</span> {toastMessage}
          </div>
        </div>
      )}

      <div className="pk-layout-container">
        {/* ==============================================================
           1. TOPBAR
           ============================================================== */}
        <header className="pk-hud-topbar">
          <div className="pk-topbar-brand">
            <img className="pk-topbar-logo" src="/assets/peeranki-logo.webp" alt="Peeranki" />
            <span className="pk-topbar-title">PEERANKI</span>
          </div>

          <div className="pk-topbar-meta">
            <button
              type="button"
              className={`pk-net-status-badge ${isOnline ? 'is-online' : ''}`}
              onClick={() => {
                if (roomCode) {
                  navigator.clipboard.writeText(roomCode);
                  showToast(`📋 Room Code ${roomCode} copied!`);
                }
              }}
            >
              <span className="pk-net-dot">{isOnline ? '🟢' : '🤖'}</span>
              <span className="pk-net-label">{isOnline ? `ROOM ${roomCode}` : 'BOT MATCH'}</span>
              {isOnline && <span className="pk-net-copy-hint">📋</span>}
            </button>

            <div className="pk-match-timer-badge">
              <span aria-hidden="true">⏱️</span>
              <span className="pk-timer-display">{timeDisplay}</span>
            </div>

            <span className="pk-match-round-text">ROUND {round}</span>
          </div>

          <div className="pk-topbar-actions">
            <button
              type="button"
              className="pk-btn-icon pk-btn-fullscreen"
              title="Toggle Fullscreen"
              onClick={() => {
                try {
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                  } else {
                    document.exitFullscreen();
                  }
                } catch {
                  // ignore
                }
              }}
            >
              ⛶
            </button>

            <button
              type="button"
              className="pk-btn-icon pk-btn-help"
              title="How to Play Guide"
              onClick={onOpenGuide}
            >
              ❓
            </button>

            <button
              type="button"
              className="pk-btn-icon pk-audio-btn"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              onClick={() => {
                const next = PeerankiAudio.toggleMute();
                setIsMuted(next);
              }}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>

            <button
              type="button"
              className="pk-btn-leave"
              onClick={onLeaveMatch}
            >
              LEAVE
            </button>
          </div>
        </header>

        {/* ==============================================================
           2. ANNOUNCER BANNER
           ============================================================== */}
        <div className={`pk-announcer-banner ${isMyTurn ? 'pk-alert-turn' : ''}`}>
          <span>
            {isMyTurn
              ? `🎯 YOUR TURN TO FIRE! (⏱️ ${actionSecondsLeft}s)`
              : phase === 'shooting' && currentShooterIndex >= 0
              ? `⏳ Waiting for ${players[currentShooterIndex]?.name} to fire... (⏱️ ${actionSecondsLeft}s)`
              : statusMessage}
          </span>
        </div>

        {/* ==============================================================
           3. ARENA BOARD GRID (Strict 1-Screen Sizing)
           ============================================================== */}
        <main className="pk-board-scroll-area">
          <div
            className={`pk-board-grid pk-players-${players.length} ${isCompactGrid ? 'is-compact-grid' : ''}`}
            style={{
              gridTemplateColumns: `repeat(${gridLayout.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridLayout.rows}, minmax(0, 1fr))`,
              gap: isCompactGrid ? '4px' : '8px',
            }}
          >
            {players.map((p, idx) => {
              const isMe = p.id === localPlayerId;
              const isShooter = idx === currentShooterIndex && p.alive;
              const isTargetable = isMyTurn && !isMe && p.alive;
              const isPendingDouble = idx === pendingDoubleTargetIndex;
              const isEliminated = !p.alive || p.stage >= 3;
              const isFlashing = idx === flashingTargetIndex;
              const avatarDef = getAvatarDef(p.avatar);
              const stageIdx = Math.max(0, Math.min(3, p.stage));

              return (
                <div
                  key={p.id}
                  className={`pk-player-card ${isShooter ? 'pk-is-shooter' : ''} ${
                    isTargetable ? 'pk-is-targetable' : ''
                  } ${isPendingDouble ? 'pk-pending-double' : ''} ${isEliminated ? 'pk-eliminated' : ''} ${
                    isFlashing ? 'pk-card-damage-flash' : ''
                  } ${isCompactGrid ? 'pk-card-compact' : ''}`}
                  onClick={() => handlePlayerCardClick(idx)}
                >
                  {/* Header */}
                  <div className="pk-card-header">
                    <img
                      src={`/${avatarDef.svgPath}`}
                      alt={avatarDef.name}
                      style={{
                        width: isCompactGrid ? '18px' : '22px',
                        height: isCompactGrid ? '18px' : '22px',
                        borderRadius: '50%',
                        border: `1.5px solid ${avatarDef.color}`,
                        flexShrink: 0,
                      }}
                    />
                    <span className="pk-card-name" style={{ fontSize: isCompactGrid ? '10.5px' : '11.5px' }}>
                      {avatarDef.emoji} {p.name}
                    </span>
                    <span className={`pk-card-role-tag ${isShooter ? 'shooter-badge' : ''}`} style={{ fontSize: isCompactGrid ? '9px' : '10px' }}>
                      {isMe ? 'YOU' : isShooter ? 'SHOOTER' : p.isBot ? 'BOT' : ''}
                    </span>
                  </div>

                  {/* Tower visual */}
                  <div
                    className="pk-tower-stage-wrapper"
                    style={{
                      maxHeight: isCompactGrid ? 'clamp(24px, 4.2vh, 42px)' : '56px',
                      margin: isCompactGrid ? '1px 0' : '3px 0',
                    }}
                  >
                    <img
                      className="pk-tower-img"
                      src={TOWER_IMAGES[stageIdx]}
                      alt={STAGE_NAMES[stageIdx]}
                      style={{
                        maxHeight: isCompactGrid ? 'clamp(22px, 4vh, 40px)' : '52px',
                      }}
                    />
                  </div>

                  {/* Stage name */}
                  <div className="pk-card-stage-name" style={{ fontSize: isCompactGrid ? '9.5px' : '11px', marginBottom: isCompactGrid ? '1px' : '3px' }}>
                    {STAGE_NAMES[stageIdx]}
                  </div>

                  {/* Weapons Inventory Row */}
                  <div className="pk-card-weapons-row" style={{ minHeight: isCompactGrid ? '14px' : '18px', gap: isCompactGrid ? '2px' : '3px' }}>
                    {p.weapons.map((w, wIdx) => {
                      const isDisabledShield = w === 'shield' && p.shieldDisabledRound === round;
                      return (
                        <img
                          key={wIdx}
                          className="pk-card-weapon-icon"
                          src={WEAPON_INFO[w]?.icon ?? `/assets/weapons/${w}.png`}
                          alt={w}
                          title={
                            w === 'shield' && isDisabledShield
                              ? 'Shield (Shattered this round)'
                              : WEAPON_INFO[w]?.label ?? w
                          }
                          style={{
                            width: isCompactGrid ? '13px' : '16px',
                            height: isCompactGrid ? '13px' : '16px',
                            opacity: isDisabledShield ? 0.35 : 1,
                            filter: isDisabledShield
                              ? 'grayscale(100%)'
                              : w === 'shield'
                              ? 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.6))'
                              : 'none',
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Points */}
                  <div className="pk-card-points" style={{ fontSize: isCompactGrid ? '9px' : '10px', marginTop: isCompactGrid ? '1px' : '2px' }}>
                    ⭐ {p.eliminationPoints} pt{p.eliminationPoints === 1 ? '' : 's'}
                  </div>

                  {/* Target Hint badge */}
                  {isPendingDouble ? (
                    <div className="pk-target-hint" style={{ background: '#f2cf66', color: '#111', fontSize: isCompactGrid ? '8.5px' : '10px' }}>
                      1ST TARGET
                    </div>
                  ) : isTargetable ? (
                    <div className="pk-target-hint" style={{ fontSize: isCompactGrid ? '8.5px' : '10px' }}>CLICK TO SHOOT</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </main>

        {/* ==============================================================
           4. BOTTOM ACTION HUD
           ============================================================== */}
        <footer className="pk-hud-bottombar">
          <div className="pk-action-prompt-row">
            <div className="pk-action-prompt-text">
              <span className="pk-prompt-main">
                {isMyTurn
                  ? selectedWeapon === 'doublePeeranki'
                    ? pendingDoubleTargetIndex >= 0
                      ? '💥 Double Peeranki: Tap a different second target!'
                      : '💥 Double Peeranki: Tap your first target'
                    : `🔫 Your turn! Tap an opponent to fire ${WEAPON_INFO[selectedWeapon]?.label}`
                  : phase === 'counting'
                  ? 'Kerala Chant in progress...'
                  : phase === 'duel'
                  ? '⚔️ Rock–Paper–Scissors Duel in progress'
                  : 'Stand by for round action...'}
              </span>
            </div>
            <div className="pk-action-prompt-subtext">
              {isMyTurn ? WEAPON_INFO[selectedWeapon]?.desc : ''}
            </div>
          </div>

          <div className="pk-weapon-selector-dock">
            <button
              type="button"
              className="pk-weapon-cycle-btn pk-cycle-prev"
              aria-label="Previous Weapon"
              onClick={() => handleCycleWeapon(-1)}
            >
              ‹
            </button>

            <div className="pk-weapon-chip-list">
              {activeWeaponsList.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={`pk-weapon-chip ${w === selectedWeapon ? 'pk-selected' : ''}`}
                  onClick={() => {
                    PeerankiAudio.effect('click');
                    setSelectedWeapon(w);
                    setPendingDoubleTargetIndex(-1);
                  }}
                >
                  <img className="pk-chip-icon" src={WEAPON_INFO[w]?.icon} alt={WEAPON_INFO[w]?.label} />
                  <span>{WEAPON_INFO[w]?.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="pk-weapon-cycle-btn pk-cycle-next"
              aria-label="Next Weapon"
              onClick={() => handleCycleWeapon(1)}
            >
              ›
            </button>
          </div>

          <div className="pk-keyboard-hint">Keyboard: press numbers 1–9 to target a player directly</div>
        </footer>

        {/* ==============================================================
           5. COUNTDOWN OVERLAY
           ============================================================== */}
        {phase === 'counting' && countNumber > 0 && (
          <div className="pk-countdown-banner" style={{ display: 'flex' }}>
            <div className="pk-countdown-num">{countNumber}</div>
            <div className="pk-countdown-sub">
              {countNumber === 10 ? 'SHOOTER SELECTED!' : 'PEERANKI COUNTING...'}
            </div>
          </div>
        )}

        {/* ==============================================================
           6. RPS DUEL MODAL
           ============================================================== */}
        {phase === 'duel' && duelState && (
          <div className="pk-modal-backdrop" style={{ display: 'flex' }}>
            <div className="pk-duel-card-dialog">
              <div className="pk-duel-title">⚔️ DUEL ROUND {duelState.round}</div>
              <div className="pk-duel-subtitle">Both remaining fortresses choose simultaneously!</div>

              <div className="pk-duel-versus-bar">
                <div className={`pk-duel-fighter ${duelState.myChoice ? 'is-ready' : 'is-waiting'}`}>
                  <span className="pk-fighter-name">YOU</span>
                  <span className="pk-fighter-badge">
                    {duelState.myChoice ? '🔒 LOCKED IN' : '⏳ CHOOSING...'}
                  </span>
                </div>
                <div className="pk-duel-vs-divider">VS</div>
                <div className={`pk-duel-fighter ${duelState.opponentSubmitted ? 'is-ready' : 'is-waiting'}`}>
                  <span className="pk-fighter-name">{duelState.fighter2.name}</span>
                  <span className="pk-fighter-badge">
                    {duelState.opponentSubmitted ? '🔒 LOCKED IN' : '⏳ CHOOSING...'}
                  </span>
                </div>
              </div>

              {/* Clash cards when both revealed */}
              {duelState.myChoice && duelState.opponentChoice && (
                <div className="pk-duel-clash-box">
                  <div className="pk-clash-card">
                    <span className="pk-clash-icon">
                      {RPS_CHOICES.find((c) => c.id === duelState.myChoice)?.emoji}
                    </span>
                    <span className="pk-clash-label">YOU</span>
                  </div>
                  <div className="pk-clash-vs-text">VS</div>
                  <div className="pk-clash-card">
                    <span className="pk-clash-icon">
                      {RPS_CHOICES.find((c) => c.id === duelState.opponentChoice)?.emoji}
                    </span>
                    <span className="pk-clash-label">{duelState.fighter2.name}</span>
                  </div>
                </div>
              )}

              {/* Choice Buttons */}
              <div className="pk-rps-buttons-grid">
                {RPS_CHOICES.map((choice) => {
                  const isSelected = duelState.myChoice === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      disabled={Boolean(duelState.myChoice)}
                      className={`pk-rps-choice-btn ${isSelected ? 'pk-selected' : ''}`}
                      onClick={() => handleDuelChoice(choice.id)}
                    >
                      <span className="pk-rps-emoji">{choice.emoji}</span>
                      <span className="pk-rps-label">{choice.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="pk-duel-status-line">{duelState.resultMessage}</div>
            </div>
          </div>
        )}

        {/* ==============================================================
           7. GAME OVER MODAL
           ============================================================== */}
        {phase === 'gameover' && (
          <div className="pk-modal-backdrop" style={{ display: 'flex' }}>
            <div className="pk-gameover-dialog">
              <div className="pk-gameover-content">
                <div className="pk-gameover-trophy">🏆</div>
                <div className="pk-gameover-title">MATCH COMPLETED</div>
                <div className="pk-gameover-winner-name">
                  {gameOverWinners.map((w) => w.name).join(' & ') || 'Match Finished'}
                </div>

                <div className="pk-gameover-stats-list">
                  {[...players]
                    .sort((a, b) => b.eliminationPoints - a.eliminationPoints || b.weapons.length - a.weapons.length)
                    .map((p, rank) => {
                      const isWinner = gameOverWinners.some((w) => w.id === p.id);
                      return (
                        <div key={p.id} className="pk-gameover-stat-row">
                          <span>
                            {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}.`}{' '}
                            {p.name}
                            {isWinner ? ' (Winner)' : ''}
                          </span>
                          <span style={{ fontWeight: 700, color: '#f2cf66' }}>
                            ⭐ {p.eliminationPoints} pts · {p.weapons.length} weapons
                          </span>
                        </div>
                      );
                    })}
                </div>

                <div className="pk-gameover-actions-row">
                  <button
                    type="button"
                    className="pk-btn-primary"
                    onClick={() => {
                      PeerankiAudio.effect('select');
                      setPlayers(
                        initialPlayers.map((p) => ({
                          ...p,
                          stage: 0,
                          alive: true,
                          weapons: ['gun'],
                          eliminationPoints: 0,
                          shieldDisabledRound: -1,
                        })),
                      );
                      setRemainingSeconds(matchDurationMinutes * 60);
                      startNextRound(1, 0);
                    }}
                  >
                    PLAY AGAIN
                  </button>
                  <button
                    type="button"
                    className="pk-btn-secondary"
                    onClick={onOpenDuelLog}
                  >
                    📜 DUEL LOG & SUMMARY
                  </button>
                  <button
                    type="button"
                    className="pk-btn-secondary"
                    onClick={onLeaveMatch}
                  >
                    MAIN MENU
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
