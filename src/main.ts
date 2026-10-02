import Phaser from 'phaser';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import './style.css';

import {
  saveGameState,
  subscribeToGameState,
  createPrivateRoom,
  joinRoom,
  findOrCreateRandomRoom,
  fetchGameRoom,
  leaveRoom,
  leaveRoomBestEffort,
  touchPlayer,
  cleanupStalePlayers,
  supabase,
} from './supabase';

interface Player {
  id: number;
  name: string;
  stage: number;
  alive: boolean;
  sessionId: string;
  connected: boolean;
  lastSeen: string;
  weapons: WeaponType[];
  hasCollectedAllWeapons: boolean;
  eliminationPoints: number;
  shieldDisabledRound: number;
  matchStartedAt: string;
  matchRound: number;
  countingStartIndex: number;
  roundWinnerId: number;
  matchOver: boolean;
  actionRequest: OnlineAction | null;
  duelChoice: RpsChoice | null;
  duelChoiceRequest: OnlineDuelChoiceRequest | null;
}

type WeaponType = 'gun' | 'peeranki' | 'shield' | 'hook' | 'doublePeeranki';
type RpsChoice = 'rock' | 'paper' | 'scissors';
type OnlineAction = { nonce: string; shooterId: number; weapon: WeaponType; targetIds: number[] };
type OnlineDuelChoiceRequest = { nonce: string; playerId: number; round: number; choice: RpsChoice };

function normalizeOnlineAction(value: unknown): OnlineAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.nonce !== 'string' || !raw.nonce || !Number.isInteger(raw.shooterId) ||
      typeof raw.weapon !== 'string' || !ACTIVE_WEAPONS.includes(raw.weapon as WeaponType) ||
      !Array.isArray(raw.targetIds) || raw.targetIds.length < 1 || raw.targetIds.length > 2 ||
      !raw.targetIds.every((id) => Number.isInteger(id))) return null;
  return { nonce: raw.nonce, shooterId: raw.shooterId as number, weapon: raw.weapon as WeaponType, targetIds: raw.targetIds as number[] };
}

const WEAPON_ORDER: WeaponType[] = ['gun', 'peeranki', 'shield', 'hook', 'doublePeeranki'];
const ACTIVE_WEAPONS: WeaponType[] = ['gun', 'peeranki', 'hook', 'doublePeeranki'];
const WEAPON_LABELS: Record<WeaponType, string> = {
  gun: '🔫 Gun', peeranki: '⚡ Peeranki', shield: '🛡️ Shield',
  hook: '🪝 Hook', doublePeeranki: '💥 Double Peeranki',
};
const WEAPON_NAMES: Record<WeaponType, string> = {
  gun: 'Gun', peeranki: 'Peeranki', shield: 'Shield', hook: 'Hook', doublePeeranki: 'Double Peeranki',
};
const RPS_CHOICES: RpsChoice[] = ['rock', 'paper', 'scissors'];
const RPS_LABELS: Record<RpsChoice, string> = {
  rock: '🪨 Rock', paper: '📄 Paper', scissors: '✂️ Scissors',
};
const MATCH_DURATIONS = [3, 5, 10, 15] as const;
let matchDurationMinutes: (typeof MATCH_DURATIONS)[number] = 5;
const matchDurationMs = () => matchDurationMinutes * 60 * 1000;

function normalizeWeapons(value: unknown): WeaponType[] {
  if (!Array.isArray(value)) return ['gun'];
  const valid = value.filter((weapon): weapon is WeaponType =>
    typeof weapon === 'string' && WEAPON_ORDER.includes(weapon as WeaponType));
  const available = new Set<WeaponType>(valid);
  const normalized: WeaponType[] = ['gun'];
  WEAPON_ORDER.slice(1).forEach((weapon, index) => {
    const prerequisites = WEAPON_ORDER.slice(1, index + 1);
    if (available.has(weapon) && prerequisites.every((prerequisite) => normalized.includes(prerequisite))) {
      normalized.push(weapon);
    }
  });
  return normalized;
}

function nextWeaponUpgrade(weapons: WeaponType[], round: number): WeaponType | undefined {
  const eligible = WEAPON_ORDER.slice(1, Math.min(round, WEAPON_ORDER.length - 1) + 1);
  return eligible.find((weapon) => {
    const index = WEAPON_ORDER.indexOf(weapon);
    const prerequisites = WEAPON_ORDER.slice(1, index);
    return !weapons.includes(weapon) && prerequisites.every((prerequisite) => weapons.includes(prerequisite));
  });
}

function normalizeRpsChoice(value: unknown): RpsChoice | null {
  return typeof value === 'string' && RPS_CHOICES.includes(value as RpsChoice)
    ? value as RpsChoice
    : null;
}

function normalizeDuelChoiceRequest(value: unknown): OnlineDuelChoiceRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const choice = normalizeRpsChoice(raw.choice);
  if (typeof raw.nonce !== 'string' || !raw.nonce ||
      !Number.isInteger(raw.playerId) || !Number.isInteger(raw.round) || !choice) return null;
  return { nonce: raw.nonce, playerId: raw.playerId as number, round: raw.round as number, choice };
}

type PeerankiSettings = {
  musicVolume: number;
  soundEffectsVolume: number;
  fullscreen: boolean;
  keyboardControls: boolean;
};

const SETTINGS_KEY = 'peeranki-settings';
const DEFAULT_SETTINGS: PeerankiSettings = {
  musicVolume: 70,
  soundEffectsVolume: 80,
  fullscreen: false,
  keyboardControls: true,
};

function loadSettings(): PeerankiSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return {
      musicVolume: clampSetting(stored.musicVolume, DEFAULT_SETTINGS.musicVolume),
      soundEffectsVolume: clampSetting(stored.soundEffectsVolume, DEFAULT_SETTINGS.soundEffectsVolume),
      fullscreen: typeof stored.fullscreen === 'boolean' ? stored.fullscreen : DEFAULT_SETTINGS.fullscreen,
      keyboardControls: typeof stored.keyboardControls === 'boolean' ? stored.keyboardControls : DEFAULT_SETTINGS.keyboardControls,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function clampSetting(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function saveSettings(settings: PeerankiSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  PeerankiAudio.applySettings();
}

// All sounds are synthesized locally, so no network or bundled audio is required.
class PeerankiAudioSystem {
  private context?: AudioContext;
  private musicGain?: GainNode;
  private effectsGain?: GainNode;
  private musicTimer?: number;
  private musicStep = 0;

  private getContext() {
    if (!this.context) {
      this.context = new AudioContext();
      this.musicGain = this.context.createGain();
      this.effectsGain = this.context.createGain();
      this.musicGain.connect(this.context.destination);
      this.effectsGain.connect(this.context.destination);
      this.applySettings();
    }
    return this.context;
  }

  applySettings() {
    const settings = loadSettings();
    const now = this.context?.currentTime ?? 0;
    this.musicGain?.gain.setTargetAtTime(settings.musicVolume / 100 * 0.16, now, 0.04);
    this.effectsGain?.gain.setTargetAtTime(settings.soundEffectsVolume / 100 * 0.22, now, 0.04);
  }

  startMusic() {
    const context = this.getContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    if (this.musicTimer !== undefined) return;
    const notes = [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 246.94, 293.66, 369.99, 440, 369.99, 196, 246.94, 293.66, 392];
    const playNext = () => {
      this.applySettings();
      const frequency = notes[this.musicStep % notes.length];
      this.musicStep += 1;
      this.tone(frequency, 0.42, 0.065, this.musicGain, 'sine');
      if (this.musicStep % 4 === 0) this.tone(frequency / 2, 0.75, 0.035, this.musicGain, 'triangle');
    };
    playNext();
    this.musicTimer = window.setInterval(playNext, 480);
  }

  effect(name: 'click' | 'select' | 'shoot' | 'hit' | 'elimination' | 'victory') {
    const context = this.getContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    this.startMusic();
    this.applySettings();
    const patterns: Record<typeof name, number[]> = {
      click: [620], select: [440, 660], shoot: [180, 110], hit: [520, 390],
      elimination: [330, 220, 110], victory: [523.25, 659.25, 783.99, 1046.5],
    };
    const durations: Record<typeof name, number> = {
      click: 0.07, select: 0.11, shoot: 0.13, hit: 0.14, elimination: 0.2, victory: 0.28,
    };
    patterns[name].forEach((frequency, index) => {
      window.setTimeout(() => this.tone(frequency, durations[name], 0.65, this.effectsGain, name === 'shoot' ? 'sawtooth' : 'sine'), index * (name === 'victory' ? 120 : 75));
    });
  }

  private tone(frequency: number, duration: number, volume: number, destination?: GainNode, type: OscillatorType = 'sine') {
    const context = this.context;
    if (!context || !destination || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const start = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}

const PeerankiAudio = new PeerankiAudioSystem();

declare global {
  interface Window {
    peerankiDesktop?: {
      setFullscreen: (fullscreen: boolean) => Promise<boolean>;
      onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
      quit: () => void;
    };
  }
}

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const PLAYER_COUNTS = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, index) => MIN_PLAYERS + index,
);

// Offline game state
let offlineMode = false;
let offlinePlayers: Player[] = [];
let offlineMaxPlayers = MIN_PLAYERS;
let shootingDeadlineAt = '';
let matchStartedAt = '';
let matchRound = 1;
let lastRoundMessage = '';
let countingStartIndex = -1;
let roundWinnerId = 0;
let matchOver = false;
let duelRound = 1;
const processedOnlineActionNonces = new Set<string>();

function createOfflinePlayers(
  playerName: string,
  totalPlayers: number,
): Player[] {
  const offlinePlayers: Player[] = [];

  offlinePlayers.push({
    id: 1,
    name: playerName || 'Player',
    stage: 0,
    alive: true,
    sessionId: 'offline-human',
    connected: true,
    lastSeen: new Date().toISOString(),
    weapons: ['gun'],
    hasCollectedAllWeapons: false,
    eliminationPoints: 0,
    shieldDisabledRound: -1,
    matchStartedAt: '',
    matchRound: 1,
    countingStartIndex: -1,
    roundWinnerId: 0,
    matchOver: false,
    actionRequest: null,
    duelChoice: null,
    duelChoiceRequest: null,
  });

  for (let i = 2; i <= totalPlayers; i++) {
    offlinePlayers.push({
      id: i,
      name: `Bot ${i - 1}`,
      stage: 0,
      alive: true,
      sessionId: `offline-bot-${i}`,
      connected: true,
      lastSeen: new Date().toISOString(),
      weapons: ['gun'],
      hasCollectedAllWeapons: false,
      eliminationPoints: 0,
      shieldDisabledRound: -1,
      matchStartedAt: '',
      matchRound: 1,
      countingStartIndex: -1,
      roundWinnerId: 0,
      matchOver: false,
      actionRequest: null,
      duelChoice: null,
      duelChoiceRequest: null,
    });
  }

  return offlinePlayers;
}

const COUNT_TO = 10;
const ACTION_LIMIT_MS = 10_000;
const COUNTING_SPEED = 200;
const NEXT_ROUND_DELAY = 900;
const HEARTBEAT_INTERVAL = 5000;
const STALE_PLAYER_SECONDS = 30;

let roomCode = '';
let myPlayerId = 0;
let maxPlayers = MIN_PLAYERS;
let isPublicRoom = false;
let hostSessionId = '';
let players: Player[] = [];

const sessionId = getOrCreateSessionId();
const previousRoomCleanup = cleanupPreviousSession();
let heartbeatTimer: number | undefined;
let cleanupTimer: number | undefined;

const stageNames = [
  'Big Tower',
  'Two Small Towers',
  'One Tower',
  'Eliminated',
];

function getOrCreateSessionId() {
  const key = 'peeranki-session-id';
  let id = sessionStorage.getItem(key);

  if (!id) {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      id = crypto.randomUUID();
    } else {
      id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    sessionStorage.setItem(key, id);
  }

  return id;
}

async function cleanupPreviousSession() {
  const oldRoomCode = sessionStorage.getItem(
    'peeranki-room-code',
  );

  if (!oldRoomCode) {
    return;
  }

  try {
    await leaveRoom(oldRoomCode, sessionId);
  } catch (error) {
    console.error(
      'Previous session cleanup failed:',
      error,
    );
  }

  sessionStorage.removeItem('peeranki-room-code');
  sessionStorage.removeItem('peeranki-room-public');
}

function rememberRoom(code: string, publicRoom: boolean) {
  sessionStorage.setItem('peeranki-room-code', code);
  sessionStorage.setItem(
    'peeranki-room-public',
    publicRoom ? 'true' : 'false',
  );
}

function forgetRoom() {
  sessionStorage.removeItem('peeranki-room-code');
  sessionStorage.removeItem('peeranki-room-public');
  stopRoomHeartbeat();
}

function amHost() {
  return hostSessionId === sessionId;
}

function findMyPlayerId() {
  const me = players.find(
    (player) =>
      player.connected &&
      player.sessionId === sessionId,
  );

  myPlayerId = me?.id ?? 0;
}

function createEmptyPlayer(id: number): Player {
  return {
    id,
    name: `Player ${id}`,
    stage: 0,
    alive: false,
    sessionId: '',
    connected: false,
    lastSeen: '',
    weapons: ['gun'],
    hasCollectedAllWeapons: false,
    eliminationPoints: 0,
    shieldDisabledRound: -1,
    matchStartedAt,
    matchRound,
    countingStartIndex: -1,
    roundWinnerId: 0,
    matchOver: false,
    actionRequest: null,
    duelChoice: null,
    duelChoiceRequest: null,
  };
}


function loadPlayersFromRoom(roomPlayers: unknown[]) {
  const byId = new Map<number, Player>();
  const sharedDeadline = roomPlayers.find((player: any) =>
    typeof player?.shooting_deadline_at === 'string' && player.shooting_deadline_at,
  ) as Record<string, unknown> | undefined;
  shootingDeadlineAt = typeof sharedDeadline?.shooting_deadline_at === 'string'
    ? sharedDeadline.shooting_deadline_at
    : '';
  const sharedDuelRound = roomPlayers.find((player: any) =>
    Number.isInteger(player?.duel_round) && player.duel_round > 0,
  ) as Record<string, unknown> | undefined;
  duelRound = typeof sharedDuelRound?.duel_round === 'number' ? sharedDuelRound.duel_round : 1;

  roomPlayers.forEach((rawPlayer: any) => {
    const id = Number(rawPlayer?.id);

    if (!Number.isInteger(id) || id < 1 || id > maxPlayers) {
      return;
    }

    if (typeof rawPlayer?.round_message === 'string' && rawPlayer.round_message) {
      lastRoundMessage = rawPlayer.round_message;
    }
    if (MATCH_DURATIONS.includes(Number(rawPlayer?.match_duration_minutes) as (typeof MATCH_DURATIONS)[number])) {
      matchDurationMinutes = Number(rawPlayer.match_duration_minutes) as (typeof MATCH_DURATIONS)[number];
    }

    byId.set(id, {
      id,
      name:
        typeof rawPlayer?.name === 'string' &&
        rawPlayer.name.trim()
          ? rawPlayer.name
          : `Player ${id}`,
      stage:
        Number.isInteger(rawPlayer?.stage) &&
        rawPlayer.stage >= 0 &&
        rawPlayer.stage <= 3
          ? rawPlayer.stage
          : 0,
      alive:
        typeof rawPlayer?.alive === 'boolean'
          ? rawPlayer.alive
          : true,
      sessionId:
        typeof rawPlayer?.session_id === 'string'
          ? rawPlayer.session_id
          : typeof rawPlayer?.sessionId === 'string'
            ? rawPlayer.sessionId
            : '',
      connected:
        typeof rawPlayer?.connected === 'boolean'
          ? rawPlayer.connected
          : true,
      lastSeen:
        typeof rawPlayer?.last_seen === 'string'
          ? rawPlayer.last_seen
          : '',
      weapons: normalizeWeapons(rawPlayer?.weapons),
      hasCollectedAllWeapons: rawPlayer?.all_weapons_collected === true ||
        WEAPON_ORDER.every((weapon) => normalizeWeapons(rawPlayer?.weapons).includes(weapon)),
      eliminationPoints: Number.isInteger(rawPlayer?.elimination_points) && Number(rawPlayer.elimination_points) >= 0
        ? Number(rawPlayer.elimination_points) : 0,
      shieldDisabledRound: Number.isInteger(rawPlayer?.shield_disabled_round)
        ? rawPlayer.shield_disabled_round : -1,
      matchStartedAt: typeof rawPlayer?.match_started_at === 'string'
        ? rawPlayer.match_started_at : '',
      matchRound: Number.isInteger(rawPlayer?.match_round) && rawPlayer.match_round > 0
        ? rawPlayer.match_round : 1,
      countingStartIndex: Number.isInteger(rawPlayer?.counting_start_index) ? rawPlayer.counting_start_index : -1,
      roundWinnerId: Number.isInteger(rawPlayer?.round_winner_id) ? rawPlayer.round_winner_id : 0,
      matchOver: rawPlayer?.match_over === true,
      actionRequest: normalizeOnlineAction(rawPlayer?.action_request),
      duelChoice: normalizeRpsChoice(rawPlayer?.duel_choice),
      duelChoiceRequest: normalizeDuelChoiceRequest(rawPlayer?.duel_choice_request),
    });
  });

  const fixedPlayers: Player[] = [];

  for (let index = 0; index < maxPlayers; index += 1) {
    fixedPlayers.push(
      byId.get(index + 1) ??
        createEmptyPlayer(index + 1),
    );
  }

  players = fixedPlayers;
  const matchData = players.find((player) => player.matchStartedAt);
  if (matchData) {
    matchStartedAt = matchData.matchStartedAt;
    matchRound = matchData.matchRound;
  }
  const sharedMatchData = players.find((player) => player.matchStartedAt);
  if (sharedMatchData) {
    countingStartIndex = sharedMatchData.countingStartIndex;
    roundWinnerId = sharedMatchData.roundWinnerId;
    matchOver = sharedMatchData.matchOver;
  }
  findMyPlayerId();
}

function activePlayers() {
  return players.filter(
    (player) => player.connected && player.alive,
  );
}

function connectedPlayers() {
  return players.filter(
    (player) => player.connected,
  );
}

async function syncGameState(
  currentShooter: number | null,
  countNumber: number,
  gameStatus: string,
) {
  if (!roomCode || players.length === 0) {
    return;
  }

  const connected = players
    .filter((player) => player.connected)
    .map((player) => ({
      id: player.id,
      name: player.name,
      stage: player.stage,
      alive: player.alive,
      session_id: player.sessionId,
      connected: true,
      last_seen: player.lastSeen,
      weapons: player.weapons,
      all_weapons_collected: player.hasCollectedAllWeapons,
      elimination_points: player.eliminationPoints,
      shield_disabled_round: player.shieldDisabledRound,
      match_started_at: matchStartedAt,
      match_round: matchRound,
      counting_start_index: countingStartIndex,
      round_winner_id: roundWinnerId,
      match_over: matchOver,
      action_request: player.actionRequest,
      duel_choice: player.duelChoice,
      duel_choice_request: player.duelChoiceRequest,
      duel_round: duelRound,
      round_message: lastRoundMessage,
      match_duration_minutes: matchDurationMinutes,
      shooting_deadline_at: shootingDeadlineAt,
    }));

  await saveGameState(
    roomCode,
    connected,
    maxPlayers,
    currentShooter,
    countNumber,
    gameStatus,
  );
}

function startRoomHeartbeat() {
  stopRoomHeartbeat();

  heartbeatTimer = window.setInterval(() => {
    if (!roomCode) {
      return;
    }

    void touchPlayer(
      roomCode,
      sessionId,
    );

    if (amHost()) {
      void cleanupStalePlayers(
        roomCode,
        STALE_PLAYER_SECONDS,
      );
    }
  }, HEARTBEAT_INTERVAL);

  document.addEventListener(
    'visibilitychange',
    handleVisibilityChange,
  );
}

function stopRoomHeartbeat() {
  if (heartbeatTimer !== undefined) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }

  if (cleanupTimer !== undefined) {
    window.clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }

  document.removeEventListener(
    'visibilitychange',
    handleVisibilityChange,
  );
}

function handleVisibilityChange() {
  if (
    document.visibilityState === 'visible' &&
    roomCode
  ) {
    void touchPlayer(
      roomCode,
      sessionId,
    );
  }
}

async function leaveCurrentRoom() {
  const code = roomCode;

  if (!code) {
    return;
  }

  try {
    await leaveRoom(code, sessionId);
  } catch (error) {
    console.error('Leave room failed:', error);
  }

  roomCode = '';
  myPlayerId = 0;
  hostSessionId = '';
  forgetRoom();
}

window.addEventListener('pagehide', () => {
  const code = sessionStorage.getItem(
    'peeranki-room-code',
  );

  if (code) {
    leaveRoomBestEffort(code, sessionId);
  }
});

function removePeerankiInputs() {
  document
    .querySelectorAll('input[id^="peeranki-"]')
    .forEach((element) => element.remove());
}

function positionHtmlInput(
  scene: Phaser.Scene,
  input: HTMLInputElement,
  gameX: number,
  gameY: number,
  width = 280,
) {
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / scene.scale.width;
  const scaleY = rect.height / scene.scale.height;
  const cssWidth = Math.min(
    width,
    rect.width * 0.72,
  );

  input.style.position = 'fixed';
  input.style.left = `${
    rect.left + gameX * scaleX
  }px`;
  input.style.top = `${
    rect.top + gameY * scaleY
  }px`;
  input.style.transform = 'translate(-50%, -50%)';
  input.style.width = `${cssWidth}px`;
  input.style.padding = '13px 16px';
  input.style.fontSize = `${Math.max(
    16,
    Math.round(19 * scaleX),
  )}px`;
  input.style.textAlign = 'center';
  input.style.boxSizing = 'border-box';
  input.style.border = '2px solid #444c55';
  input.style.borderRadius = '8px';
  input.style.backgroundColor = '#ffffff';
  input.style.color = '#111111';
  input.style.outline = 'none';
  input.style.zIndex = '10000';
}

function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  backgroundColor = '#2878ff',
  fontSize = 24,
) {
  const button = scene.add
    .text(x, y, label, {
      fontFamily: 'Arial',
      fontSize: `${fontSize}px`,
      color: '#ffffff',
      backgroundColor,
      padding: {
        x: 34,
        y: 16,
      },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
    .on('pointerdown', () => PeerankiAudio.effect('click'));
  button.on('pointerover', () => scene.tweens.add({ targets: button, scale: 1.06, duration: 100, ease: 'Quad.Out' }));
  button.on('pointerout', () => scene.tweens.add({ targets: button, scale: 1, duration: 100, ease: 'Quad.Out' }));
  button.on('pointerdown', () => scene.tweens.add({ targets: button, scale: 0.96, duration: 70, yoyo: true }));
  return button;
}

function addMatchDurationPicker(scene: Phaser.Scene, x: number, y: number) {
  scene.add.text(x, y - 27, 'MATCH TIME', {
    fontFamily: 'Arial', fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);
  MATCH_DURATIONS.forEach((minutes, index) => {
    const button = makeButton(scene, x + (index - 1.5) * 112, y + 12,
      `${minutes} MIN`, minutes === matchDurationMinutes ? '#20a060' : '#444c55', 15);
    button.setPadding(16, 9, 16, 9);
    button.on('pointerdown', () => {
      matchDurationMinutes = minutes;
      scene.children.list.forEach((child) => {
        if (child instanceof Phaser.GameObjects.Text && child.getData('matchDuration') !== undefined) {
          child.setStyle({ backgroundColor: Number(child.getData('matchDuration')) === minutes ? '#20a060' : '#444c55' });
        }
      });
    });
    button.setData('matchDuration', minutes);
  });
}

class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  preload() {
    this.load.image('peeranki-logo', 'assets/peeranki-logo.png');
  }

  create() {
    removePeerankiInputs();
    PeerankiAudio.startMusic();

    const { width, height } = this.scale;

    const glow = this.add.circle(width / 2, height * 0.23, 112, 0x2878ff, 0.12);
    this.tweens.add({ targets: glow, alpha: 0.24, scale: 1.12, duration: 1500, yoyo: true, repeat: -1 });
    this.add.image(width / 2, height * 0.23, 'peeranki-logo').setDisplaySize(190, 190);

    this.add
      .text(
        width / 2,
        height * 0.385,
        'Traditional Kerala Game',
        {
          fontFamily: 'Arial',
          fontSize: '20px',
          color: '#bbbbbb',
        },
      )
      .setOrigin(0.5);

    const offlineButton = makeButton(
  this,
  width / 2,
  height * 0.45,
  'OFFLINE PLAY',
  '#20a060',
  28,
);

const onlineButton = makeButton(
  this,
  width / 2,
  height * 0.60,
  'ONLINE PLAY',
  '#2878ff',
  28,
);

offlineButton.on('pointerdown', () => {
  this.scene.start('OfflineSetupScene');
});

onlineButton.on('pointerdown', () => {
  this.scene.start('OnlineModeScene');
});

    const settingsButton = makeButton(
      this,
      width / 2,
      height * 0.75,
      'SETTINGS',
      '#444c55',
      22,
    );

    settingsButton.on('pointerdown', () => {
      this.scene.start('SettingsScene');
    });

    const exitButton = makeButton(this, width - 68, 42, 'EXIT', '#9b3030', 16)
      .setPadding(18, 11)
      .setDepth(1000);
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      exitButton.setPosition(gameSize.width - 68, 42);
    });
    exitButton.on('pointerdown', async () => {
      if (window.peerankiDesktop) {
        window.peerankiDesktop.quit();
      } else if (Capacitor.getPlatform() === 'android') {
        await App.exitApp();
      } else {
        window.close();
      }
    });
  }
}

class SettingsScene extends Phaser.Scene {
  constructor() {
    super('SettingsScene');
  }

  create() {
    removePeerankiInputs();
    const { width, height } = this.scale;
    const settings = loadSettings();

    this.add.text(width / 2, 75, 'SETTINGS', {
      fontFamily: 'Arial', fontSize: '42px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);

    const redraw = () => this.scene.restart();
    const addVolumeSetting = (label: string, key: 'musicVolume' | 'soundEffectsVolume', y: number) => {
      this.add.text(width / 2, y - 34, label, {
        fontFamily: 'Arial', fontSize: '20px', color: '#ffffff',
      }).setOrigin(0.5);
      const minus = makeButton(this, width / 2 - 130, y, '−', '#444c55', 20);
      const value = this.add.text(width / 2, y, `${settings[key]}%`, {
        fontFamily: 'Arial', fontSize: '22px', color: '#ffffff',
      }).setOrigin(0.5);
      const plus = makeButton(this, width / 2 + 130, y, '+', '#444c55', 20);
      minus.on('pointerdown', () => { settings[key] = Math.max(0, settings[key] - 10); saveSettings(settings); redraw(); });
      plus.on('pointerdown', () => { settings[key] = Math.min(100, settings[key] + 10); saveSettings(settings); redraw(); });
      void value;
    };

    addVolumeSetting('MUSIC VOLUME', 'musicVolume', height * 0.25);
    addVolumeSetting('SOUND EFFECTS VOLUME', 'soundEffectsVolume', height * 0.40);

    const fullscreen = makeButton(this, width / 2, height * 0.55,
      `FULLSCREEN: ${settings.fullscreen ? 'ON' : 'OFF'}`, '#444c55', 18);
    fullscreen.on('pointerdown', async () => {
      settings.fullscreen = !settings.fullscreen;
      saveSettings(settings);
      if (window.peerankiDesktop) {
        await window.peerankiDesktop.setFullscreen(settings.fullscreen);
      } else if (settings.fullscreen) {
        await document.documentElement.requestFullscreen?.();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      }
      redraw();
    });

    const keyboard = makeButton(this, width / 2, height * 0.68,
      `KEYBOARD CONTROLS: ${settings.keyboardControls ? 'ON' : 'OFF'}`, '#444c55', 18);
    keyboard.on('pointerdown', () => {
      settings.keyboardControls = !settings.keyboardControls;
      saveSettings(settings);
      redraw();
    });

    const back = this.add.text(width / 2, height * 0.84, 'BACK', {
      fontFamily: 'Arial', fontSize: '18px', color: '#bbbbbb',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('MenuScene'));
  }
}
class OfflineSetupScene extends Phaser.Scene {
  private selectedPlayers = MIN_PLAYERS;
  

  constructor() {
    super('OfflineSetupScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;
    const isAndroid = Capacitor.getPlatform() === 'android';

    this.add
      .text(width / 2, 90, 'OFFLINE PLAY', {
        fontFamily: 'Arial',
        fontSize: '42px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 155, 'Play against Bots', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    // Player name
    this.add
      .text(width / 2, height * 0.30, 'YOUR NAME', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const nameInput = document.createElement('input');

    nameInput.id = 'peeranki-offline-name';
    nameInput.type = 'text';
    nameInput.placeholder = 'Enter your name';
    nameInput.maxLength = 16;
    nameInput.value = 'Player';

    document.body.appendChild(nameInput);

    const rect = this.game.canvas.getBoundingClientRect();

nameInput.style.position = 'fixed';
nameInput.style.left = `${rect.left + rect.width / 2}px`;
nameInput.style.top = `${rect.top + rect.height * 0.37}px`;
nameInput.style.transform = 'translate(-50%, -50%)';
nameInput.style.width = `${Math.min(320, rect.width * 0.65)}px`;
nameInput.style.padding = '13px 16px';
nameInput.style.fontSize = '18px';
nameInput.style.textAlign = 'center';
nameInput.style.boxSizing = 'border-box';
nameInput.style.border = '2px solid #444c55';
nameInput.style.borderRadius = '8px';
nameInput.style.backgroundColor = '#ffffff';
nameInput.style.color = '#111111';
nameInput.style.outline = 'none';
nameInput.style.zIndex = '10000';

    this.add
      .text(width / 2, height * 0.49, 'NUMBER OF PLAYERS', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const playerCounts = PLAYER_COUNTS;

    playerCounts.forEach((count, index) => {
      const columns = 4;
      const row = Math.floor(index / columns);
      const column = index % columns;

      const x =
        width / 2 +
        (column - (columns - 1) / 2) * 90;

      const y =
        height * 0.55 + row * 58;

      const button = makeButton(
        this,
        x,
        y,
        String(count),
        count === this.selectedPlayers ? '#20a060' : '#444c55',
        22,
      );

      button.setData('playerCount', count);

      button.on('pointerdown', () => {
        this.selectedPlayers = count;

        this.children.list.forEach((child) => {
          if (
            child instanceof Phaser.GameObjects.Text &&
            child.getData('playerCount')
          ) {
            const childCount = child.getData('playerCount');

            child.setStyle({
              backgroundColor:
                childCount === this.selectedPlayers
                  ? '#20a060'
                  : '#444c55',
            });
          }
        });
      });

      
    });

    addMatchDurationPicker(this, width / 2, height * 0.73);

    const startButton = makeButton(
      this,
      width / 2,
      height * (isAndroid ? 0.82 : 0.88),
      'START GAME',
      '#20a060',
      22,
    );

   startButton.on('pointerdown', () => {
  const playerName =
    nameInput.value.trim() || 'Player';

  offlineMode = true;
  offlineMaxPlayers = this.selectedPlayers;

  offlinePlayers = createOfflinePlayers(
    playerName,
    offlineMaxPlayers,
  );

  console.log('Offline players created:', offlinePlayers);

  nameInput.remove();

  this.scene.start('GameScene', {
    offline: true,
  });
});

    const backButton = this.add
      .text(width / 2, height * (isAndroid ? 0.90 : 0.96), 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backButton.on('pointerdown', () => {
      nameInput.remove();
      this.scene.start('MenuScene');
    });

    this.events.once('shutdown', () => {
      nameInput.remove();
    });
  }
}
class OnlineModeScene extends Phaser.Scene {
  constructor() {
    super('OnlineModeScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;

    addMatchDurationPicker(this, width / 2, height * 0.30);

    this.add
      .text(width / 2, 90, 'ONLINE PLAY', {
        fontFamily: 'Arial',
        fontSize: '42px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const friendsButton = makeButton(
      this,
      width / 2,
      height * 0.48,
      'PLAY WITH FRIENDS',
      '#2878ff',
      22,
    );

    const randomButton = makeButton(
      this,
      width / 2,
      height * 0.63,
      'RANDOM PLAYERS',
      '#444c55',
      22,
    );

    const backButton = this.add
      .text(width / 2, height * 0.82, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    friendsButton.on('pointerdown', () => {
      this.scene.start('FriendsScene');
    });

    randomButton.on('pointerdown', () => {
      this.scene.start('PlayerCountScene', {
        mode: 'random',
      });
    });

    backButton.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
  }
}

class FriendsScene extends Phaser.Scene {
  constructor() {
    super('FriendsScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;

    this.add
      .text(width / 2, 90, 'PLAY WITH FRIENDS', {
        fontFamily: 'Arial',
        fontSize: '36px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const createButton = makeButton(
      this,
      width / 2,
      height * 0.40,
      'CREATE GAME',
    );

    const joinButton = makeButton(
      this,
      width / 2,
      height * 0.55,
      'JOIN GAME',
      '#444c55',
    );

    const backButton = this.add
      .text(width / 2, height * 0.76, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    createButton.on('pointerdown', () => {
      this.scene.start('PlayerCountScene', {
        mode: 'private',
      });
    });

    joinButton.on('pointerdown', () => {
      this.scene.start('JoinScene');
    });

    backButton.on('pointerdown', () => {
      this.scene.start('OnlineModeScene');
    });
  }
}

class PlayerCountScene extends Phaser.Scene {
  private mode: 'private' | 'random' = 'private';
  private nameInput?: HTMLInputElement;
  private resizeHandler = () => {
    if (this.nameInput) {
      positionHtmlInput(
        this,
        this.nameInput,
        this.scale.width / 2,
        350,
      );
    }
  };

  constructor() {
    super('PlayerCountScene');
  }

  init(data: { mode?: 'private' | 'random' }) {
    this.mode =
      data?.mode === 'random'
        ? 'random'
        : 'private';
  }

  create() {
    removePeerankiInputs();

    const { width } = this.scale;
    let selectedCount = MIN_PLAYERS;

    this.add
      .text(
        width / 2,
        this.mode === 'random' ? 52 : 75,
        this.mode === 'private'
          ? 'CHOOSE PLAYERS'
          : 'RANDOM MATCH',
        {
          fontFamily: 'Arial',
          fontSize: '36px',
          color: '#ffffff',
          fontStyle: 'bold',
        },
      )
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        this.mode === 'random' ? 91 : 125,
        this.mode === 'private'
          ? 'Choose the number of players for your room.'
          : 'Choose the number of players for random matchmaking.',
        {
          fontFamily: 'Arial',
          fontSize: '17px',
          color: '#bbbbbb',
          align: 'center',
        },
      )
      .setOrigin(0.5);

    const selectedText = this.add
      .text(width / 2, this.mode === 'random' ? 135 : 185, `${MIN_PLAYERS} PLAYERS`, {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#4da3ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const choices = PLAYER_COUNTS;
    const choiceButtons: Phaser.GameObjects.Text[] = [];

    choices.forEach((count, index) => {
      const x = width / 2 + ((index % 4) - 1.5) * 145;
      const y = this.mode === 'random'
        ? 195 + Math.floor(index / 4) * 52
        : 245 + Math.floor(index / 4) * 65;

      const button = this.add
        .text(x, y, String(count), {
          fontFamily: 'Arial',
          fontSize: '24px',
          color: '#ffffff',
          backgroundColor:
            count === selectedCount
              ? '#2878ff'
              : '#2a3037',
          padding: {
            x: 20,
            y: 16,
          },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      choiceButtons.push(button);

      button.on('pointerdown', () => {
        selectedCount = count;
        selectedText.setText(
          `${selectedCount} PLAYERS`,
        );

        choiceButtons.forEach(
          (choiceButton, choiceIndex) => {
            choiceButton.setBackgroundColor(
              choices[choiceIndex] === selectedCount
                ? '#2878ff'
                : '#2a3037',
            );
          },
        );
      });
    });

    if (this.mode === 'random') {
      this.add
        .text(width / 2, 315, 'YOUR NAME', {
          fontFamily: 'Arial',
          fontSize: '18px',
          color: '#bbbbbb',
        })
        .setOrigin(0.5);

      this.nameInput = document.createElement('input');
      this.nameInput.id =
        'peeranki-random-player-name';
      this.nameInput.type = 'text';
      this.nameInput.placeholder = 'Enter your name';
      this.nameInput.maxLength = 20;
      this.nameInput.autocomplete = 'name';
      document.body.appendChild(this.nameInput);

      positionHtmlInput(
        this,
        this.nameInput,
        this.scale.width / 2,
        350,
      );

      window.addEventListener(
        'resize',
        this.resizeHandler,
      );
    }

    const actionButton = makeButton(
      this,
      width / 2,
      this.mode === 'random' ? 430 : 400,
      this.mode === 'private'
        ? 'CREATE ROOM'
        : 'FIND MATCH',
    );

    const backButton = this.add
      .text(
        width / 2,
        this.mode === 'random' ? 495 : 500,
        'BACK',
        {
          fontFamily: 'Arial',
          fontSize: '18px',
          color: '#bbbbbb',
        },
      )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    actionButton.on('pointerdown', async () => {
      actionButton.disableInteractive();
      backButton.disableInteractive();
      actionButton.setText(
        this.mode === 'private'
          ? 'CREATING...'
          : 'FINDING...',
      );

      await previousRoomCleanup;

      if (this.mode === 'private') {
        const result = await createPrivateRoom(
          selectedCount,
          sessionId,
        );

        if (!result) {
          actionButton.setText('CREATE FAILED');
          actionButton.setInteractive({
            useHandCursor: true,
          });
          backButton.setInteractive({
            useHandCursor: true,
          });
          return;
        }

        roomCode = String(result.room_code);
        maxPlayers = Number(result.max_players);
        isPublicRoom = false;
        hostSessionId = String(
          result.host_session_id ?? sessionId,
        );

        loadPlayersFromRoom(
          Array.isArray(result.players)
            ? result.players
            : [],
        );

        rememberRoom(roomCode, false);
        startRoomHeartbeat();
        this.scene.start('LobbyScene');
        return;
      }

      const name =
        this.nameInput?.value.trim() ?? '';

      if (!name) {
        actionButton.setText('ENTER NAME');
        actionButton.setInteractive({
          useHandCursor: true,
        });
        backButton.setInteractive({
          useHandCursor: true,
        });
        this.nameInput?.focus();
        return;
      }

      const result =
        await findOrCreateRandomRoom(
          selectedCount,
          name,
          sessionId,
        );

      if (!result) {
        actionButton.setText('MATCH FAILED');
        actionButton.setInteractive({
          useHandCursor: true,
        });
        backButton.setInteractive({
          useHandCursor: true,
        });
        return;
      }

      removePeerankiInputs();

      roomCode = String(result.room_code);
      maxPlayers = Number(result.max_players);
      isPublicRoom = true;
      hostSessionId = String(
        result.host_session_id ?? '',
      );

      loadPlayersFromRoom(
        Array.isArray(result.players)
          ? result.players
          : [],
      );

      findMyPlayerId();
      rememberRoom(roomCode, true);
      startRoomHeartbeat();

      this.scene.start('LobbyScene');
    });

    backButton.on('pointerdown', () => {
      removePeerankiInputs();
      this.scene.start(
        this.mode === 'private'
          ? 'FriendsScene'
          : 'OnlineModeScene',
      );
    });
  }

  shutdown() {
    window.removeEventListener(
      'resize',
      this.resizeHandler,
    );
    this.nameInput?.remove();
    this.nameInput = undefined;
  }
}

class JoinScene extends Phaser.Scene {
  private roomInput?: HTMLInputElement;
  private nameInput?: HTMLInputElement;
  private resizeHandler = () => {
    if (this.roomInput) {
      positionHtmlInput(
        this,
        this.roomInput,
        this.scale.width / 2,
        225,
      );
    }

    if (this.nameInput) {
      positionHtmlInput(
        this,
        this.nameInput,
        this.scale.width / 2,
        350,
      );
    }
  };

  constructor() {
    super('JoinScene');
  }

  create() {
    removePeerankiInputs();

    const { width } = this.scale;

    this.add
      .text(width / 2, 75, 'JOIN PRIVATE GAME', {
        fontFamily: 'Arial',
        fontSize: '36px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 165, 'ROOM CODE', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.roomInput = this.createInput(
      'ABC123',
      'peeranki-room-code',
      true,
    );

    this.add
      .text(width / 2, 290, 'YOUR NAME', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.nameInput = this.createInput(
      'Enter your name',
      'peeranki-player-name',
      false,
    );

    this.resizeHandler();
    window.addEventListener(
      'resize',
      this.resizeHandler,
    );

    const joinButton = makeButton(
      this,
      width / 2,
      480,
      'JOIN GAME',
    );

    const backButton = this.add
      .text(width / 2, 575, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    joinButton.on('pointerdown', async () => {
      const code =
        this.roomInput?.value.trim().toUpperCase() ??
        '';
      const name =
        this.nameInput?.value.trim() ?? '';

      if (code.length !== 6) {
        joinButton.setText('ENTER 6-CHAR CODE');
        this.roomInput?.focus();
        return;
      }

      if (!name) {
        joinButton.setText('ENTER NAME');
        this.nameInput?.focus();
        return;
      }

      joinButton.disableInteractive();
      backButton.disableInteractive();
      joinButton.setText('JOINING...');

      await previousRoomCleanup;

      const result = await joinRoom(
        code,
        name,
        sessionId,
      );

      if (!result) {
        joinButton.setText('JOIN FAILED');
        joinButton.setInteractive({
          useHandCursor: true,
        });
        backButton.setInteractive({
          useHandCursor: true,
        });
        return;
      }

      removePeerankiInputs();

      roomCode = String(result.room_code);
      maxPlayers = Number(result.max_players);
      isPublicRoom = Boolean(result.is_public);
      hostSessionId = String(
        result.host_session_id ?? '',
      );

      loadPlayersFromRoom(
        Array.isArray(result.players)
          ? result.players
          : [],
      );

      findMyPlayerId();
      rememberRoom(roomCode, isPublicRoom);
      startRoomHeartbeat();

      this.scene.start('LobbyScene');
    });

    backButton.on('pointerdown', () => {
      removePeerankiInputs();
      this.scene.start('FriendsScene');
    });
  }

  private createInput(
    placeholder: string,
    id: string,
    uppercase: boolean,
  ) {
    const input = document.createElement('input');

    input.id = id;
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = uppercase ? 6 : 20;
    input.autocomplete = uppercase ? 'off' : 'name';
    input.spellcheck = false;
    input.style.textTransform =
      uppercase ? 'uppercase' : 'none';

    if (uppercase) {
      input.addEventListener('input', () => {
        input.value = input.value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
      });
    }

    document.body.appendChild(input);
    return input;
  }

  shutdown() {
    window.removeEventListener(
      'resize',
      this.resizeHandler,
    );
    this.roomInput?.remove();
    this.nameInput?.remove();
    this.roomInput = undefined;
    this.nameInput = undefined;
  }
}

class LobbyScene extends Phaser.Scene {
  private playerText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private startButton?: Phaser.GameObjects.Text;
  private leaveButton?: Phaser.GameObjects.Text;
  private realtimeChannel: any;
  private refreshTimer?: Phaser.Time.TimerEvent;
  private starting = false;

  constructor() {
    super('LobbyScene');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, 55, 'WAITING ROOM', {
        fontFamily: 'Arial',
        fontSize: '38px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        105,
        `ROOM: ${roomCode}`,
        {
          fontFamily: 'Arial',
          fontSize: '27px',
          color: '#4da3ff',
          fontStyle: 'bold',
        },
      )
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        140,
        `${maxPlayers} PLAYER MATCH${
          isPublicRoom
            ? ' • RANDOM'
            : ' • PRIVATE'
        }`,
        {
          fontFamily: 'Arial',
          fontSize: '15px',
          color: '#bbbbbb',
        },
      )
      .setOrigin(0.5);

    this.playerText = this.add
      .text(width / 2, 255, 'Loading players...', {
        fontFamily: 'Arial',
        fontSize: '21px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 7,
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 470, '', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    if (amHost() && !isPublicRoom) {
      this.startButton = makeButton(
        this,
        width / 2,
        height * 0.82,
        'START GAME',
        '#2878ff',
        22,
      );

      this.startButton.on(
        'pointerdown',
        () => {
          void this.startGame();
        },
      );
    }

    this.leaveButton = this.add
      .text(width / 2, height - 58, 'LEAVE ROOM', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#ff7777',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.leaveButton.on(
      'pointerdown',
      async () => {
        this.leaveButton?.disableInteractive();
        this.statusText?.setText('Leaving room...');
        await leaveCurrentRoom();
        this.scene.start('OnlineModeScene');
      },
    );

    this.realtimeChannel = subscribeToGameState(
      roomCode,
      (gameState) => {
        this.applyRoomState(gameState);
      },
    );

    void this.refreshLobby();

    this.refreshTimer = this.time.addEvent({
      delay: 1500,
      loop: true,
      callback: () => {
        void this.refreshLobby();
      },
    });
  }

  private applyRoomState(gameState: any) {
    if (!gameState) {
      return;
    }

    if (
      Number.isFinite(Number(gameState.max_players))
    ) {
      maxPlayers = Number(
        gameState.max_players,
      );
    }

    hostSessionId = String(
      gameState.host_session_id ?? hostSessionId,
    );

    if (Array.isArray(gameState.players)) {
      loadPlayersFromRoom(gameState.players);
      this.updateLobbyText();
    }

    if (gameState.game_status === 'playing') {
      this.openGame();
    }
  }

  private async refreshLobby() {
    if (this.starting) {
      return;
    }

    const result = await fetchGameRoom(roomCode);

    if (!result) {
      this.statusText?.setText(
        'Room closed or connection failed.',
      );
      return;
    }

    this.applyRoomState(result);

    if (isPublicRoom && amHost()) {
      const count = connectedPlayers().length;

      if (
        count === maxPlayers &&
        result.game_status === 'waiting'
      ) {
        void this.startGame();
      }
    }
  }

  private updateLobbyText() {
    const connected = connectedPlayers();

    let text =
      `PLAYERS ${connected.length}/${maxPlayers}\n\n`;

    connected.forEach((player, index) => {
      const hostMark =
        player.sessionId === hostSessionId
          ? ' 👑'
          : '';
      const youMark =
        player.sessionId === sessionId
          ? ' • YOU'
          : '';

      text +=
        `${index + 1}. ${player.name}` +
        `${hostMark}${youMark}\n`;
    });

    this.playerText?.setText(text);

    if (connected.length < maxPlayers) {
      this.statusText?.setText(
        isPublicRoom
          ? `Finding players... ${connected.length}/${maxPlayers}`
          : amHost()
            ? `Waiting for ${maxPlayers - connected.length} more player(s)...`
            : 'Waiting for the host to start...',
      );

      this.startButton?.setVisible(false);
    } else {
      this.statusText?.setText(
        isPublicRoom
          ? 'Match full — starting...'
          : amHost()
            ? 'All players are ready!'
            : 'All players are ready. Waiting for host...',
      );

      if (amHost() && !isPublicRoom) {
        this.startButton?.setVisible(true);
      }
    }
  }

  private async startGame() {
    const connected = connectedPlayers();

    if (
      this.starting ||
      !amHost() ||
      connected.length !== maxPlayers
    ) {
      return;
    }

    this.starting = true;
    processedOnlineActionNonces.clear();
    this.startButton?.disableInteractive();
    this.startButton?.setText('STARTING...');

    matchStartedAt = new Date().toISOString();
    matchRound = 1;
    duelRound = 1;
    countingStartIndex = -1;
    roundWinnerId = 0;
    matchOver = false;
    lastRoundMessage = '';
    const cleanPlayers = connected.map(
      (player) => ({
        id: player.id,
        name: player.name,
        stage: 0,
        alive: true,
        session_id: player.sessionId,
        connected: true,
        last_seen: player.lastSeen,
        weapons: ['gun'],
        all_weapons_collected: false,
        elimination_points: 0,
        shield_disabled_round: -1,
        match_started_at: matchStartedAt,
        match_round: 1,
        counting_start_index: -1,
        round_winner_id: 0,
        match_over: false,
        action_request: null,
        duel_choice: null,
        duel_choice_request: null,
        duel_round: 1,
        round_message: '',
        match_duration_minutes: matchDurationMinutes,
      }),
    );

    const { error } = await supabase
      .from('game_states')
      .update({
        players: cleanPlayers,
        current_shooter: null,
        countdown: 0,
        game_status: 'playing',
        updated_at: new Date().toISOString(),
      })
      .eq('room_code', roomCode);

    if (error) {
      console.error(
        'Failed to start game:',
        error,
      );

      this.starting = false;
      this.startButton?.setText('START FAILED');
      this.startButton?.setInteractive({
        useHandCursor: true,
      });
      return;
    }

    loadPlayersFromRoom(cleanPlayers);
    this.openGame();
  }

  private openGame() {
    if (this.scene.isActive('GameScene')) {
      return;
    }

    this.starting = true;
    this.refreshTimer?.remove(false);

    this.scene.start('GameScene');
  }

  shutdown() {
    this.refreshTimer?.remove(false);

    if (this.realtimeChannel) {
      void this.realtimeChannel.unsubscribe();
      this.realtimeChannel = undefined;
    }
  }
}

class GameScene extends Phaser.Scene {
  private playerObjects: Phaser.GameObjects.Container[] = [];
  private statusText?: Phaser.GameObjects.Text;
  private countText?: Phaser.GameObjects.Text;
  private shooterText?: Phaser.GameObjects.Text;
  private leaveButton?: Phaser.GameObjects.Text;
  private matchText?: Phaser.GameObjects.Text;
  private weaponText?: Phaser.GameObjects.Text;
  private weaponImage?: Phaser.GameObjects.Image;
  private previousRoundText?: Phaser.GameObjects.Text;
  private matchTimer?: Phaser.Time.TimerEvent;
  private actionTimer?: Phaser.Time.TimerEvent;
  private selectedWeapon: WeaponType = 'gun';
  private pendingDoubleTarget = -1;

 private currentShooter = -1;
private startIndex = -1;
private countNumber = 0;
private nextStartIndex = -1;

  private countingTimer?: Phaser.Time.TimerEvent;
  private nextRoundTimer?: Phaser.Time.TimerEvent;
  private realtimeChannel: any;
  private applyingRemoteState = false;
  private initialized = false;
  private gameFinished = false;
  private victoryPlayed = false;
  private roundPhase: 'counting' | 'shooting' | 'duel' | 'waiting' | 'finished' = 'waiting';
  private duelActive = false;
  private resolvingDuel = false;
  private processingDuelChoices = false;
  private duelUi: Phaser.GameObjects.GameObject[] = [];
  private duelPrompt?: Phaser.GameObjects.Text;
  private duelBotTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('GameScene');
  }

  preload() {
     this.load.image(
    'game_background',
    'assets/background/game_background.png',
  );
    this.load.image('tower_big', 'assets/towers/tower_big.png');
    this.load.image('tower_small', 'assets/towers/tower_small.png');
    this.load.image('tower_one', 'assets/towers/tower_one.png');
    this.load.image('tower_destroyed', 'assets/towers/tower_destroyed.png');
    WEAPON_ORDER.forEach((weapon) => this.load.image(`weapon-${weapon}`, `assets/weapons/${weapon === 'doublePeeranki' ? 'double_peeranki' : weapon}.png`));
  }

  create() {
    this.gameFinished = false;
    this.victoryPlayed = false;
    this.duelActive = false;
    this.resolvingDuel = false;
    this.processingDuelChoices = false;
    this.clearDuelControls();
    this.roundPhase = 'waiting';
    this.currentShooter = -1;
    this.startIndex = -1;
    this.countNumber = 0;
    this.nextStartIndex = -1;
    this.pendingDoubleTarget = -1;
    this.selectedWeapon = 'gun';
    shootingDeadlineAt = '';
    if (offlineMode) {
  console.log('Offline mode active');
}
    const { width, height } = this.scale;
        const background = this.add
      .image(width / 2, height / 2, 'game_background')
      .setOrigin(0.5);

    const scaleX = width / background.width;
    const scaleY = height / background.height;
    const backgroundScale = Math.max(scaleX, scaleY);

    background.setScale(backgroundScale);
    background.setDepth(-100);
    const topOverlay = this.add.rectangle(
  width / 2,
  92,
  width,
  185,
  0x000000,
  0.28,
);

topOverlay.setDepth(-50);
const bottomOverlay = this.add.rectangle(
  width / 2,
  height - 42,
  width,
  90,
  0x000000,
  0.22,
);

bottomOverlay.setDepth(-50);

if (offlineMode) {
  maxPlayers = offlineMaxPlayers;

  players.splice(
    0,
    players.length,
    ...offlinePlayers,
  );

  console.log(
    'Offline players loaded into GameScene:',
    players,
  );

  this.renderPlayers();
}

    this.add.image(width / 2, 35, 'peeranki-logo').setDisplaySize(52, 52);

    this.shooterText = this.add
      .text(width / 2, 76, '', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#4da3ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 105, '', {
        fontFamily: 'Arial',
        fontSize: '15px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.matchText = this.add.text(width / 2, 135, `MATCH ${String(matchDurationMinutes).padStart(2, '0')}:00 • ROUND 1`, {
      fontFamily: 'Arial', fontSize: '23px', color: '#f2cf66', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.previousRoundText = this.add.text(width / 2, 169, '', {
      fontFamily: 'Arial', fontSize: '14px', color: '#f2cf66', fontStyle: 'bold',
    }).setOrigin(0.5);
    const controlsY = height - 104;
    const previousWeapon = makeButton(this, width / 2 - 155, controlsY, '‹', '#444c55', 15);
    this.weaponImage = this.add.image(width / 2 - 94, controlsY, 'weapon-gun').setDisplaySize(46, 46);
    this.weaponText = this.add.text(width / 2 + 22, controlsY, '', {
      fontFamily: 'Arial', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    const nextWeapon = makeButton(this, width / 2 + 155, controlsY, '›', '#444c55', 15);
    previousWeapon.on('pointerdown', () => this.cycleWeapon(-1));
    nextWeapon.on('pointerdown', () => this.cycleWeapon(1));
    this.refreshWeaponPicker();

    this.countText = this.add
      .text(width / 2, height - 44, '', {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.leaveButton = this.add
      .text(width - 54, 32, 'LEAVE', {
        fontFamily: 'Arial',
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor: '#9b3030',
        padding: { left: 12, right: 12, top: 9, bottom: 9 },
      })
      .setOrigin(0.5)
      .setDepth(1000)
      .setInteractive({ useHandCursor: true });

    // Keep the touch target inside the visible game area as Phaser FIT resizes.
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.leaveButton?.setPosition(gameSize.width - 54, 32);
    });

    this.leaveButton.on(
      'pointerdown',
      async () => {
        this.leaveButton?.disableInteractive();
        this.statusText?.setText('Leaving game...');
        if (offlineMode) {
          this.scene.start('OfflineSetupScene');
        } else {
          await leaveCurrentRoom();
          this.scene.start('OnlineModeScene');
        }
      },
    );

    if (loadSettings().keyboardControls) {
      this.add.text(width / 2, height - 24, 'Keyboard: press 1–9 (0 = player 10) to choose a target', {
        fontFamily: 'Arial', fontSize: '12px', color: '#777777',
      }).setOrigin(0.5, 1);
      this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
        const index = event.key === '0' ? 9 : Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < maxPlayers) {
          this.shootPlayer(index);
        }
      });
    }

    if (offlineMode) {
  matchStartedAt = new Date().toISOString();
  matchRound = 1;
  duelRound = 1;
  lastRoundMessage = '';
  matchOver = false;
  players.forEach((player) => {
    player.weapons = ['gun']; player.shieldDisabledRound = -1;
    player.hasCollectedAllWeapons = false;
    player.eliminationPoints = 0;
    player.duelChoice = null; player.duelChoiceRequest = null;
    player.matchStartedAt = matchStartedAt; player.matchRound = matchRound;
  });
  this.statusText?.setText('Offline game ready!');
  this.refreshPreviousRoundText();
  this.startMatchClock();
  this.time.delayedCall(500, () => this.startCounting());
} else {
  this.startRealtimeSync();
  void this.initializeGame();
}
  }

  private async initializeGame() {
    const room = await fetchGameRoom(roomCode);

    if (!room) {
      this.statusText?.setText(
        'Unable to load the game room.',
      );
      return;
    }

    if (
      Number.isFinite(Number(room.max_players))
    ) {
      maxPlayers = Number(room.max_players);
    }

    hostSessionId = String(
      room.host_session_id ?? hostSessionId,
    );

    if (Array.isArray(room.players)) {
      loadPlayersFromRoom(room.players);
    }

    this.renderPlayers();
    this.initialized = true;
    this.startMatchClock();
    this.refreshWeaponPicker();
    this.refreshPreviousRoundText();

    if (room.game_status === 'finished') {
      this.showFinishedState();
      return;
    }

    if (
      room.game_status === 'counting' ||
      room.game_status === 'shooting' ||
      room.game_status === 'shot' ||
      room.game_status === 'duel'
    ) {
      this.applyRemoteGameState(room);
      return;
    }

    if (
      room.game_status === 'playing' &&
      amHost()
    ) {
      this.startCounting();
    }
  }

  private renderPlayers() {
    const { width } = this.scale;

    this.playerObjects.forEach(
      (container) => container.destroy(),
    );

    this.playerObjects = [];

    const columns = maxPlayers <= 6 ? 3 : 5;
    const rows = Math.ceil(maxPlayers / columns);
    const cardWidth = columns <= 3 ? 180 : 140;
    const baseSpan = columns <= 3 ? 560 : 760;
    const span = Math.min(width - cardWidth - 48, baseSpan + Math.max(0, width - 900) * 0.55);
    const startX = (width - span) / 2;
    const endX = startX + span;
    const xStep =
  (endX - startX) / (columns - 1);
    const startY = rows <= 2 ? 270 : 245;
    const yStep = rows <= 2 ? 220 : 170;

    players.forEach((_, index) => {
      if (index >= maxPlayers) {
        return;
      }

      const row = Math.floor(index / columns);
      const column = index % columns;

      const x =
        startX + column * xStep;
      const y =
        startY + row * yStep;

      const container = this.add.container(
        x,
        y,
      );

      const background = this.add.rectangle(
        0,
        0,
        cardWidth,
        160,
        0x1b2229,
      );

      background.setStrokeStyle(
        2,
        0x444c55,
      );

      const name = this.add
        .text(0, -48, '', {
          fontFamily: 'Arial',
          fontSize: '16px',
          color: '#ffffff',
          fontStyle: 'bold',
          align: 'center',
        })
        .setOrigin(0.5);

      const tower = this.add.container(0, -3);

      const stage = this.add
        .text(0, 36, '', {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5);

      const slot = this.add
        .text(0, 74, '', {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#f2cf66',
        })
        .setOrigin(0.5);
      const inventory = this.add.container(0, 55);

      container.add([
        background,
        name,
        tower,
        stage,
        slot,
        inventory,
      ]);

      container.setSize(cardWidth, 160);
      container.setInteractive(
        new Phaser.Geom.Rectangle(
          -cardWidth / 2,
          -78,
          cardWidth,
          156,
        ),
        Phaser.Geom.Rectangle.Contains,
      );

      container.on(
        'pointerdown',
        () => {
          container.setScale(0.96);
          PeerankiAudio.effect('select');
          this.shootPlayer(index);
        },
      );

      container.on('pointerup', () => {
        container.setScale(1);
      });

      container.on('pointerout', () => {
        container.setScale(1);
      });

      this.playerObjects.push(container);
      this.updatePlayerVisual(index);
    });
  }

  private updatePlayerVisual(index: number) {
    const player = players[index];
    const container =
      this.playerObjects[index];

    if (!player || !container) {
      return;
    }

    const background =
      container.list[0] as Phaser.GameObjects.Rectangle;
    const name =
      container.list[1] as Phaser.GameObjects.Text;
    const tower =
      container.list[2] as Phaser.GameObjects.Container;
    const stage =
      container.list[3] as Phaser.GameObjects.Text;
    const slot =
      container.list[4] as Phaser.GameObjects.Text;
    const inventory =
      container.list[5] as Phaser.GameObjects.Container;

    name.setText(
      player.connected
        ? player.name
        : `Player ${player.id}`,
    );

    const previousStage = tower.getData('renderedStage') as number | undefined;
    const previousConnected = tower.getData('renderedConnected') as boolean | undefined;
    const stageChanged = previousStage !== undefined && previousConnected === true &&
      player.connected && previousStage !== player.stage;
    if (previousStage !== player.stage || previousConnected !== player.connected) {
      const oldVisuals = [...tower.list];
      if (!stageChanged) {
        tower.removeAll(true);
      }

      const newVisuals: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
      if (!player.connected) {
        newVisuals.push(this.add.text(0, 0, '—', {
          fontFamily: 'Arial', fontSize: '28px', color: '#aaaaaa',
        }).setOrigin(0.5));
      } else if (player.stage === 0) {
        newVisuals.push(this.add.image(0, 0, 'tower_big').setDisplaySize(64, 64));
      } else if (player.stage === 1) {
        newVisuals.push(this.add.image(0, 0, 'tower_small').setDisplaySize(58, 58));
      } else if (player.stage === 2) {
        newVisuals.push(this.add.image(0, 0, 'tower_one').setDisplaySize(58, 58));
      } else {
        newVisuals.push(this.add.image(0, 0, 'tower_destroyed').setDisplaySize(58, 58));
      }
      tower.add(newVisuals);
      tower.setData('renderedStage', player.stage);
      tower.setData('renderedConnected', player.connected);

      if (stageChanged) {
        const eliminated = player.stage >= 3;
        const targetScaleX = newVisuals[0]?.scaleX ?? 1;
        const targetScaleY = newVisuals[0]?.scaleY ?? 1;
        newVisuals.forEach((visual) => {
          visual.setAlpha(0);
          visual.setScale(targetScaleX * 0.72, targetScaleY * 0.72);
        });
        const impact = this.add.circle(0, 0, eliminated ? 23 : 16,
          eliminated ? 0xff5b35 : 0xffd166, eliminated ? 0.55 : 0.4)
          .setStrokeStyle(eliminated ? 3 : 2, eliminated ? 0xffd166 : 0xffffff)
          .setDepth(-1);
        tower.addAt(impact, 0);
        this.tweens.killTweensOf(tower);
        this.tweens.add({
          targets: tower,
          x: { from: - (eliminated ? 9 : 5), to: eliminated ? 9 : 5 },
          scale: eliminated ? 1.2 : 1.1,
          duration: eliminated ? 65 : 55,
          yoyo: true,
          repeat: eliminated ? 3 : 2,
          onComplete: () => {
            tower.setX(0);
            tower.setScale(1);
            oldVisuals.forEach((visual) => visual.destroy());
            this.tweens.add({
              targets: newVisuals,
              alpha: 1,
              scaleX: targetScaleX,
              scaleY: targetScaleY,
              duration: eliminated ? 240 : 180,
              ease: 'Back.Out',
              onComplete: () => newVisuals.forEach((visual) => visual.setScale(targetScaleX, targetScaleY)),
            });
          },
        });
        this.tweens.add({
          targets: impact,
          scale: eliminated ? 2.2 : 1.7,
          alpha: 0,
          duration: eliminated ? 330 : 220,
          onComplete: () => impact.destroy(),
        });
      }
    }

    stage.setText(
      player.connected
        ? stageNames[player.stage]
        : 'Empty',
    );

    const visibleWeapons = player.weapons.filter((weapon) => weapon !== 'shield' || player.shieldDisabledRound !== matchRound);
    inventory.removeAll(true);
    if (player.connected) {
      const iconStep = 25;
      visibleWeapons.forEach((weapon, iconIndex) => {
        inventory.add(this.add.image((iconIndex - (visibleWeapons.length - 1) / 2) * iconStep, 0, `weapon-${weapon}`).setDisplaySize(23, 23));
      });
    }
    slot.setText(player.connected ? `⭐ ${player.eliminationPoints} elimination point${player.eliminationPoints === 1 ? '' : 's'}` : 'Available slot');
    slot.setStyle({ fontSize: '10px', color: '#f2cf66', align: 'center' });

    container.setAlpha(
      player.connected
        ? player.alive
          ? 1
          : 0.35
        : 0.28,
    );

    background.setStrokeStyle(
      index === this.currentShooter &&
        player.connected
        ? 3
        : 2,
      index === this.currentShooter &&
        player.connected
        ? 0x4da3ff
        : 0x444c55,
    );
    this.tweens.killTweensOf(container);
    if (index === this.currentShooter && player.connected && player.alive) {
      this.tweens.add({ targets: container, scale: 1.05, duration: 420, yoyo: true, repeat: -1 });
    } else {
      container.setScale(1);
    }

    container.setInteractive(
      player.connected && player.alive,
    );
  }

  private markShooter() {
    for (
      let index = 0;
      index < this.playerObjects.length;
      index += 1
    ) {
      this.updatePlayerVisual(index);
    }
  }

  private startRealtimeSync() {
    this.realtimeChannel = subscribeToGameState(
      roomCode,
      (gameState) => {
        this.applyRemoteGameState(gameState);
      },
    );
  }

  private applyRemoteGameState(gameState: any) {
    if (!gameState) {
      return;
    }

    if (
      Number.isFinite(Number(gameState.max_players))
    ) {
      maxPlayers = Number(
        gameState.max_players,
      );
    }

    hostSessionId = String(
      gameState.host_session_id ?? hostSessionId,
    );

    if (Array.isArray(gameState.players)) {
      loadPlayersFromRoom(gameState.players);
      this.refreshWeaponPicker();

      if (this.initialized) {
        this.renderPlayers();
      }
    }

    if (gameState.game_status === 'finished' || matchOver) {
      this.roundPhase = 'finished';
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.nextRoundTimer?.remove(false);
      this.nextRoundTimer = undefined;
      this.showFinishedState();
      return;
    }

    if (
      typeof gameState.current_shooter === 'number'
    ) {
      const nextShooter = Number(
        gameState.current_shooter,
      );
      if (nextShooter !== this.currentShooter && gameState.game_status === 'shooting') {
        PeerankiAudio.effect('select');
      }
      this.currentShooter = nextShooter;
    } else if (gameState.current_shooter === null) {
      this.currentShooter = -1;
    }

    const remoteCount = Number(
      gameState.countdown,
    );

    if (Number.isFinite(remoteCount)) {
      this.countNumber = remoteCount;
    }

    if (gameState.game_status === 'duel') {
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.nextRoundTimer?.remove(false);
      this.nextRoundTimer = undefined;
      this.stopActionClock();
      shootingDeadlineAt = '';
      this.duelActive = true;
      this.roundPhase = 'duel';
      this.shooterText?.setText('⚔️ Rock–Paper–Scissors duel');
      this.statusText?.setText('Both players choose at the same time.');
      this.renderDuelControls();
      if (amHost()) void this.processPendingDuelChoices();
      return;
    }

    if (this.duelActive) {
      this.duelActive = false;
      this.duelBotTimer?.remove(false);
      this.duelBotTimer = undefined;
      this.clearDuelControls();
    }

    if (amHost()) void this.processPendingAction();

    if (
      gameState.game_status === 'counting'
    ) {
      this.stopActionClock();
      this.roundPhase = 'counting';
      this.countText?.setText(
        `Count ${this.countNumber} / ${COUNT_TO}`,
      );
      this.shooterText?.setText(
        '🎲 Counting to select the shooter',
      );
      this.statusText?.setText(
        'The 10th tower will select the shooter.',
      );
      this.markShooter();
      return;
    }

    if (
      gameState.game_status === 'shooting'
    ) {
      this.roundPhase = 'shooting';
      if (!shootingDeadlineAt && amHost()) {
        shootingDeadlineAt = new Date(Date.now() + ACTION_LIMIT_MS).toISOString();
        void syncGameState(this.currentShooter, COUNT_TO, 'shooting');
      }
      this.startActionClock();
      const shooter =
        players[this.currentShooter];

      this.countText?.setText(
        shootingDeadlineAt
          ? `ACTION ${Math.ceil(Math.max(0, Date.parse(shootingDeadlineAt) - Date.now()) / 1000)}s • choose weapon + target(s)`
          : `Count ${COUNT_TO} / ${COUNT_TO}`,
      );
      this.shooterText?.setText(
        shooter
          ? `🎯 Shooter: ${shooter.name}`
          : '🎯 Shooter selected',
      );
      this.statusText?.setText(
        myPlayerId === this.currentShooter + 1
          ? 'Choose a weapon and target(s) before time runs out.'
          : 'Waiting for the shooter...',
      );
      this.markShooter();
      return;
    }

    if (
      gameState.game_status === 'shot'
    ) {
      this.stopActionClock();
      this.roundPhase = 'waiting';
      this.statusText?.setText(
        'Shot recorded. Next round...',
      );
      this.markShooter();

      if (
  amHost() &&
  !this.nextRoundTimer &&
  !this.countingTimer
) {
  this.nextRoundTimer =
    this.time.delayedCall(
      NEXT_ROUND_DELAY,
      () => {
        this.nextRoundTimer = undefined;

        const nextStartIndex =
          this.nextStartIndex;

        this.nextStartIndex = -1;

        if (this.isGameFinished()) {
          void this.finishRound();
        } else {
          this.startCounting(nextStartIndex >= 0 ? nextStartIndex : undefined);
        }
      },
    );
}

      return;
    }

    if (gameState.game_status === 'round_won') {
      this.stopActionClock();
      this.duelActive = false;
      this.clearDuelControls();
      this.roundPhase = 'waiting';
      this.refreshPreviousRoundText();
      this.statusText?.setText(lastRoundMessage || 'Round winner advances!');
      this.shooterText?.setText(lastRoundMessage || 'Round winner advances!');
      this.markShooter();
      if (amHost() && !this.nextRoundTimer) {
        this.nextRoundTimer = this.time.delayedCall(NEXT_ROUND_DELAY, () => {
          this.nextRoundTimer = undefined;
          this.startCounting();
        });
      }
      return;
    }

    if (
      gameState.game_status === 'finished'
    ) {
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.nextRoundTimer?.remove(false);
      this.nextRoundTimer = undefined;
      this.showFinishedState();
    }
  }
  private beginDuel() {
    if (this.duelActive || this.gameFinished) return;
    this.duelActive = true;
    this.resolvingDuel = false;
    duelRound = 1;
    this.currentShooter = -1;
    this.roundPhase = 'duel';
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.stopActionClock();
    shootingDeadlineAt = '';
    players.forEach((player) => {
      player.duelChoice = null;
      player.duelChoiceRequest = null;
    });
    this.shooterText?.setText('⚔️ Rock–Paper–Scissors duel');
    this.statusText?.setText('Both remaining players choose at the same time.');
    this.countText?.setText(`DUEL ${duelRound}`);
    this.renderDuelControls();
    if (!offlineMode) void syncGameState(null, 0, 'duel');
    else this.scheduleOfflineBotChoices();
  }

  private clearDuelControls() {
    this.duelUi.forEach((object) => object.destroy());
    this.duelUi = [];
    this.duelPrompt = undefined;
  }

  private renderDuelControls() {
    this.clearDuelControls();
    if (!this.duelActive || this.gameFinished) return;
    const { width, height } = this.scale;
    const contestants = activePlayers().filter((player) => player.alive);
    const localId = offlineMode ? 1 : myPlayerId;
    const localPlayer = players[localId - 1];
    const mayChoose = contestants.length === 2 && localPlayer?.alive && contestants.some((player) => player.id === localId);
    const hasSubmitted = Boolean(localPlayer?.duelChoice || localPlayer?.duelChoiceRequest);

    this.duelPrompt = this.add.text(width / 2, height - 184,
      `DUEL ${duelRound} • ${mayChoose && !hasSubmitted ? 'Choose now' : hasSubmitted ? 'Choice locked — waiting for the other player' : 'Waiting for duel choices'}`,
      { fontFamily: 'Arial', fontSize: '19px', color: '#f2cf66', fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(50);
    this.duelUi.push(this.duelPrompt);
    if (mayChoose && !hasSubmitted) {
      const buttonY = height - 112;
      const buttonXs = [width / 2 - 175, width / 2, width / 2 + 175];
      RPS_CHOICES.forEach((choice, index) => {
        const button = makeButton(this, buttonXs[index], buttonY, RPS_LABELS[choice], '#34485c', 18);
        button.setPadding(18, 14, 18, 14).setDepth(50);
        button.on('pointerdown', () => this.submitDuelChoice(choice));
        this.duelUi.push(button);
      });
    }
  }

  private submitDuelChoice(choice: RpsChoice) {
    if (!this.duelActive || this.gameFinished) return;
    const playerId = offlineMode ? 1 : myPlayerId;
    const player = players[playerId - 1];
    const aliveContestants = activePlayers().filter((candidate) => candidate.alive);
    if (!player?.alive || !aliveContestants.some((candidate) => candidate.id === playerId) ||
        player.duelChoice || player.duelChoiceRequest) return;

    if (offlineMode) {
      player.duelChoice = choice;
      this.statusText?.setText(`Your ${RPS_LABELS[choice]} choice is locked. Waiting for the other player...`);
      this.renderDuelControls();
      this.scheduleOfflineBotChoices();
      void this.resolveDuelIfReady();
      return;
    }

    player.duelChoiceRequest = {
      nonce: `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      playerId,
      round: duelRound,
      choice,
    };
    this.statusText?.setText('Choice sent. Waiting for both players...');
    this.renderDuelControls();
    void syncGameState(null, 0, 'duel').then(() => {
      if (amHost()) return this.processPendingDuelChoices();
    });
  }

  private scheduleOfflineBotChoices() {
    if (!offlineMode || !this.duelActive || this.duelBotTimer) return;
    const missingBots = activePlayers().filter((player) => player.alive && player.id !== 1 && !player.duelChoice);
    if (missingBots.length === 0) return;
    this.duelBotTimer = this.time.delayedCall(420, () => {
      this.duelBotTimer = undefined;
      if (!this.duelActive) return;
      activePlayers().filter((player) => player.alive && player.id !== 1 && !player.duelChoice)
        .forEach((player) => { player.duelChoice = Phaser.Utils.Array.GetRandom(RPS_CHOICES); });
      this.renderDuelControls();
      void this.resolveDuelIfReady();
    });
  }

  private async processPendingDuelChoices() {
    if (!amHost() || !this.duelActive || this.processingDuelChoices || this.gameFinished) return;
    this.processingDuelChoices = true;
    try {
      let changed = false;
      players.forEach((owner) => {
        const request = owner.duelChoiceRequest;
        if (!request) return;
        owner.duelChoiceRequest = null;
        changed = true;
        if (request.playerId === owner.id && request.round === duelRound && owner.connected && owner.alive &&
            !owner.duelChoice && normalizeRpsChoice(request.choice)) {
          owner.duelChoice = request.choice;
        }
      });
      if (changed) await syncGameState(null, 0, 'duel');
      await this.resolveDuelIfReady();
    } finally {
      this.processingDuelChoices = false;
    }
  }

  private async resolveDuelIfReady() {
    if (!this.duelActive || this.resolvingDuel || this.gameFinished || (!offlineMode && !amHost())) return;
    const contestants = activePlayers().filter((player) => player.alive);
    if (contestants.length !== 2 || contestants.some((player) => !player.duelChoice)) return;
    this.resolvingDuel = true;
    const [first, second] = contestants as [Player, Player];
    const firstChoice = first.duelChoice!;
    const secondChoice = second.duelChoice!;
    const beats: Record<RpsChoice, RpsChoice> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    if (firstChoice === secondChoice) {
      first.duelChoice = null;
      second.duelChoice = null;
      players.forEach((player) => { player.duelChoiceRequest = null; });
      duelRound += 1;
      this.countText?.setText(`DUEL ${duelRound}`);
      this.statusText?.setText(`Tie! Both chose ${RPS_LABELS[firstChoice]}. Choose again.`);
      this.renderDuelControls();
      if (!offlineMode) await syncGameState(null, 0, 'duel');
      else this.scheduleOfflineBotChoices();
      this.resolvingDuel = false;
      return;
    }

    const winner = beats[firstChoice] === secondChoice ? first : second;
    const loser = winner.id === first.id ? second : first;
    loser.alive = false;
    loser.stage = 3;
    players.forEach((player) => {
      player.duelChoice = null;
      player.duelChoiceRequest = null;
    });
    const resultMessage = `${winner.name} won the duel (${RPS_LABELS[winner.id === first.id ? firstChoice : secondChoice]} beats ${RPS_LABELS[winner.id === first.id ? secondChoice : firstChoice]}) and Round ${matchRound}!`;
    this.duelActive = false;
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();
    this.resolvingDuel = false;
    await this.finishRound(resultMessage);
  }

  private startCounting(forcedStartIndex?: number) {
  if (
    (!offlineMode && !amHost()) ||
    this.countingTimer ||
    this.nextRoundTimer ||
    this.gameFinished
  ) {
    return;
  }
  if (this.matchTimeExpired()) {
    if (offlineMode || amHost()) void this.finishMatch();
    return;
  }

  const aliveIndexes = activePlayers()
    .map((player) => player.id - 1)
    .filter(
      (index) =>
        players[index]?.alive === true,
    );

  if (aliveIndexes.length <= 1) {
    void this.finishRound();
    return;
  }

  if (aliveIndexes.length === 2) {
    this.beginDuel();
    return;
  }

  const forcedStartIsAlive =
  typeof forcedStartIndex === 'number' &&
  aliveIndexes.includes(forcedStartIndex);

this.startIndex = forcedStartIsAlive
  ? forcedStartIndex
  : Phaser.Utils.Array.GetRandom(
      aliveIndexes,
    );

  countingStartIndex = this.startIndex;
  players.forEach((player) => { player.countingStartIndex = countingStartIndex; });

  this.currentShooter = -1;
  this.stopActionClock();
  shootingDeadlineAt = '';
  this.roundPhase = 'counting';
  this.countNumber = 0;

  this.shooterText?.setText(
    `🎲 Start: ${players[this.startIndex].name}`,
  );

  this.statusText?.setText(
    `Counting ${COUNT_TO} towers...`,
  );

  this.countText?.setText(
    `Count 0 / ${COUNT_TO}`,
  );

  if (!offlineMode) {
    void syncGameState(
      null,
      0,
      'counting',
    );
  }

  this.countingTimer =
    this.time.addEvent({
      delay: COUNTING_SPEED,
      repeat: COUNT_TO - 1,

      callback: () => {
        this.countNumber += 1;

        const countedIndex =
          this.getCountedPlayerIndex(
            this.startIndex,
            this.countNumber,
          );

        if (countedIndex === -1) {
          return;
        }

        this.currentShooter =
          countedIndex;

        this.countText?.setText(
          `Count ${this.countNumber} / ${COUNT_TO}`,
        );

        this.statusText?.setText(
          `${this.countNumber}. ${players[countedIndex].name}`,
        );

        if (
          this.countNumber === COUNT_TO
        ) {
          this.roundPhase = 'shooting';
          shootingDeadlineAt = new Date(Date.now() + ACTION_LIMIT_MS).toISOString();
          this.startActionClock();
          PeerankiAudio.effect('select');
          this.shooterText?.setText(
            `🎯 Shooter: ${players[countedIndex].name}`,
          );

          this.statusText?.setText(
           `${players[countedIndex].name}: choose a weapon and target(s) within 10 seconds.`,
          );

          if (!offlineMode) {
            void syncGameState(
              countedIndex,
              COUNT_TO,
              'shooting',
            );
          }

          this.countingTimer = undefined;

          // 🤖 Offline bot automatically shoots
          if (
            offlineMode &&
            players[countedIndex].id !== 1
          ) {
            this.time.delayedCall(
            350,
              () => {
                this.botShoot(countedIndex);
              },
            );
          } else if (offlineMode) {
            this.statusText?.setText(
              'Choose a weapon and target(s) before time runs out.',
            );
          }
        } else {
          if (!offlineMode) {
            void syncGameState(
              countedIndex,
              this.countNumber,
              'counting',
            );
          }
        }

        this.markShooter();
      },

      callbackScope: this,
    });
}

  private startActionClock() {
    if (!this.actionTimer) {
      this.actionTimer = this.time.addEvent({
        delay: 100,
        loop: true,
        callback: () => this.updateActionClock(),
      });
    }
    this.updateActionClock();
  }

  private updateActionClock() {
    if (this.roundPhase !== 'shooting' || !shootingDeadlineAt) return;
    const deadline = Date.parse(shootingDeadlineAt);
    if (!Number.isFinite(deadline)) return;
    const remaining = Math.max(0, deadline - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    this.countText?.setText(`ACTION ${seconds}s • choose weapon + target(s)`);
    if (remaining === 0 && (offlineMode || amHost())) this.endActionOnTimeout();
  }

  private stopActionClock() {
    this.actionTimer?.remove(false);
    this.actionTimer = undefined;
  }

  private endActionOnTimeout() {
    if (
      this.gameFinished || this.roundPhase !== 'shooting' ||
      (!offlineMode && !amHost()) || !shootingDeadlineAt ||
      Date.now() < Date.parse(shootingDeadlineAt)
    ) return;

    const shooterIndex = this.currentShooter;
    this.stopActionClock();
    shootingDeadlineAt = '';
    this.pendingDoubleTarget = -1;
    players.forEach((player) => { player.actionRequest = null; });
    this.nextStartIndex = this.getNextCountingStartIndex(shooterIndex);
    this.roundPhase = 'waiting';
    this.statusText?.setText('Time is up. Starting the next tower count...');
    this.countText?.setText('ACTION TIME UP');
    if (!offlineMode) void syncGameState(shooterIndex, COUNT_TO, 'shot');

    if (!this.nextRoundTimer) {
      this.nextRoundTimer = this.time.delayedCall(NEXT_ROUND_DELAY, () => {
        this.nextRoundTimer = undefined;
        const nextStartIndex = this.nextStartIndex;
        this.nextStartIndex = -1;
        if (this.isGameFinished()) void this.finishRound();
        else this.startCounting(nextStartIndex >= 0 ? nextStartIndex : undefined);
      });
    }
  }

private botShoot(shooterIndex: number) {
  if (!offlineMode) {
    return;
  }

  const possibleTargets = players
    .map((player, index) => ({
      player,
      index,
    }))
    .filter(
      ({ player, index }) =>
        player.alive &&
        index !== shooterIndex,
    );

  if (possibleTargets.length === 0) {
    void this.finishRound();
    return;
  }

  // Bots use any weapon they own, with targets chosen from living players.
  const botWeapons = ACTIVE_WEAPONS.filter((weapon) =>
    players[shooterIndex].weapons.includes(weapon) &&
    (weapon !== 'hook' || possibleTargets.some(({ player }) => player.weapons.includes('shield') && player.shieldDisabledRound !== matchRound)) &&
    (weapon !== 'doublePeeranki' || possibleTargets.length >= 2));
  this.selectedWeapon = Phaser.Utils.Array.GetRandom(botWeapons.length ? botWeapons : ['gun']);
  const selectedTarget = Phaser.Utils.Array.GetRandom(possibleTargets);

  this.statusText?.setText(
    `${players[shooterIndex].name} is shooting ${selectedTarget.player.name}...`,
  );

  PeerankiAudio.effect('shoot');

  this.time.delayedCall(250, () => {
    if (this.currentShooter !== shooterIndex || this.roundPhase !== 'shooting') return;
    this.applyOfflineShot(
      shooterIndex,
      selectedTarget.index,
    );
  });
}

private applyOfflineShot(
  _shooterIndex: number,
  targetIndex: number,
) {
  if (!offlineMode || this.gameFinished || this.matchTimeExpired()) return;
  const target = players[targetIndex];
  if (!target || !target.alive) return;

  const weapon = this.selectedWeapon;
  if (!players[_shooterIndex]?.weapons.includes(weapon)) return;
  if (weapon === 'hook' && (!target.weapons.includes('shield') || target.shieldDisabledRound === matchRound)) return;
  if (weapon === 'doublePeeranki' && players.filter((player, index) => player.connected && player.alive && index !== _shooterIndex).length < 2) return;
  this.applyWeaponEffect(targetIndex, weapon === 'doublePeeranki' ? 'peeranki' : weapon, _shooterIndex);
  let completedTarget = targetIndex;
  if (weapon === 'doublePeeranki') {
    const secondTargets = players
      .map((player, index) => ({ player, index }))
      .filter(({ player, index }) => player.alive && index !== targetIndex && index !== _shooterIndex);
    const secondTarget = Phaser.Utils.Array.GetRandom(secondTargets);
    if (!secondTarget) return;
    this.applyWeaponEffect(secondTarget.index, 'gun', _shooterIndex);
    completedTarget = secondTarget.index;
  }
  this.completePlayerShot(completedTarget);
}

  private getCountedPlayerIndex(
  startIndex: number,
  count: number,
) {
  const aliveIndexes = activePlayers()
    .map((player) => player.id - 1)
    .filter(
      (index) =>
        players[index]?.alive === true,
    );

  if (aliveIndexes.length === 0) {
    return -1;
  }

  // Build the counting sequence using towers.
  // Stage 0 = 1 tower
  // Stage 1 = 2 towers
  // Stage 2 = 1 tower
  const countingSequence: number[] = [];

  const startPosition =
    aliveIndexes.indexOf(startIndex);

  const safeStartPosition =
    startPosition >= 0
      ? startPosition
      : 0;

  for (
    let offset = 0;
    offset < aliveIndexes.length;
    offset += 1
  ) {
    const position =
      (safeStartPosition + offset) %
      aliveIndexes.length;

    const playerIndex =
      aliveIndexes[position];

    const player =
      players[playerIndex];

    if (!player) {
      continue;
    }

    const towerCount =
      player.stage === 1
        ? 2
        : 1;

    for (
      let tower = 0;
      tower < towerCount;
      tower += 1
    ) {
      countingSequence.push(playerIndex);
    }
  }

  if (countingSequence.length === 0) {
    return -1;
  }

  const sequencePosition =
    (count - 1) %
    countingSequence.length;

  return countingSequence[sequencePosition];
}

private getNextCountingStartIndex(
  targetIndex: number,
) {
  if (players[targetIndex]?.alive) {
    return targetIndex;
  }

  for (
    let offset = 1;
    offset < players.length;
    offset += 1
  ) {
    const candidateIndex =
      (targetIndex + offset) %
      players.length;

    const candidate =
      players[candidateIndex];

    if (
      candidate?.alive &&
      candidate.connected
    ) {
      return candidateIndex;
    }
  }

  return -1;
}

private async requestHostAction(targetIds: number[]) {
  const shooter = players[myPlayerId - 1];
  if (!shooter || !ACTIVE_WEAPONS.includes(this.selectedWeapon) ||
      !shootingDeadlineAt || !Number.isFinite(Date.parse(shootingDeadlineAt))) return;
  const nonce = `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  shooter.actionRequest = {
    nonce,
    shooterId: shooter.id,
    weapon: this.selectedWeapon,
    targetIds: targetIds.map((id) => id + 1),
  };
  this.statusText?.setText('Sending action to the host...');
  await syncGameState(this.currentShooter, this.countNumber, 'action_requested');
}

private async processPendingAction() {
  if (!amHost() || this.gameFinished || this.matchTimeExpired()) return;
  const requestOwner = players.find((player) => player.actionRequest !== null);
  const action = requestOwner?.actionRequest;
  if (!requestOwner || !action) return;
  requestOwner.actionRequest = null;
  if (processedOnlineActionNonces.has(action.nonce)) {
    await syncGameState(this.currentShooter, this.countNumber, this.roundPhase === 'shooting' ? 'shooting' : 'shot');
    return;
  }
  processedOnlineActionNonces.add(action.nonce);

  const shooterIndex = action.shooterId - 1;
  const shooter = players[shooterIndex];
  const targetIndexes = action.targetIds.map((id) => id - 1);
  const uniqueTargets = new Set(targetIndexes);
  const validWeapon = ACTIVE_WEAPONS.includes(action.weapon) && shooter?.weapons.includes(action.weapon);
  const expectedTargets = action.weapon === 'doublePeeranki' ? 2 : 1;
  const validTargets = targetIndexes.length === expectedTargets && uniqueTargets.size === expectedTargets &&
    targetIndexes.every((index) => index >= 0 && index < players.length && index !== shooterIndex && players[index].connected && players[index].alive);
  const authorized = shooter?.sessionId === requestOwner.sessionId && shooterIndex === this.currentShooter && shooter.alive && shooter.connected;
  const withinDeadline = Boolean(shootingDeadlineAt) && Date.now() < Date.parse(shootingDeadlineAt);
  const validHook = action.weapon !== 'hook' || targetIndexes.length === 1 && players[targetIndexes[0]]?.weapons.includes('shield') && players[targetIndexes[0]]?.shieldDisabledRound !== matchRound;
  if (this.roundPhase !== 'shooting') {
    await syncGameState(
      this.currentShooter >= 0 ? this.currentShooter : null,
      this.countNumber,
      this.roundPhase === 'finished' ? 'finished' : 'shot',
    );
    return;
  }
  if (!withinDeadline) {
    this.endActionOnTimeout();
    return;
  }

  if (!authorized || !validWeapon || !validTargets || !validHook || this.matchTimeExpired()) {
    this.statusText?.setText('The host rejected an invalid or expired action.');
    await syncGameState(this.currentShooter, this.countNumber, 'shooting');
    return;
  }

  this.selectedWeapon = action.weapon;
  this.applyWeaponEffect(targetIndexes[0], action.weapon === 'doublePeeranki' ? 'peeranki' : action.weapon, shooterIndex);
  if (action.weapon === 'doublePeeranki') this.applyWeaponEffect(targetIndexes[1], 'gun', shooterIndex);
  this.completePlayerShot(targetIndexes[targetIndexes.length - 1]);
}

private shootPlayer(index: number) {
  if (
    this.applyingRemoteState ||
    this.gameFinished ||
    this.roundPhase !== 'shooting' ||
    this.currentShooter < 0 ||
    !shootingDeadlineAt ||
    ((offlineMode || amHost()) && Date.now() >= Date.parse(shootingDeadlineAt)) ||
    this.matchTimeExpired()
  ) {
    if (shootingDeadlineAt && Date.now() >= Date.parse(shootingDeadlineAt) && (offlineMode || amHost())) {
      this.endActionOnTimeout();
    }
    if (this.matchTimeExpired() && (offlineMode || amHost())) void this.finishMatch();
    return;
  }

  if (
    !offlineMode &&
    myPlayerId !== this.currentShooter + 1
  ) {
    this.statusText?.setText(
      'Only the selected shooter can shoot.',
    );
    return;
  }

  if (index === this.currentShooter) {
    this.statusText?.setText(
      'You cannot shoot yourself.',
    );
    return;
  }

  const target = players[index];

  if (
    !target ||
    !target.connected
  ) {
    return;
  }

  if (!target.alive) {
    this.statusText?.setText(
      'That player is already eliminated.',
    );
    return;
  }

  const shooter = players[this.currentShooter];
  if (!ACTIVE_WEAPONS.includes(this.selectedWeapon) || !shooter?.weapons.includes(this.selectedWeapon)) {
    this.statusText?.setText('You do not own that weapon.');
    this.pendingDoubleTarget = -1;
    this.refreshWeaponPicker();
    return;
  }
  if (this.selectedWeapon === 'hook' && (!target.weapons.includes('shield') || target.shieldDisabledRound === matchRound)) {
    this.statusText?.setText('Hook requires a target with a Shield.');
    return;
  }

  if (this.selectedWeapon === 'doublePeeranki' && this.pendingDoubleTarget < 0) {
    const validTargets = players.filter((player, targetIndex) => player.connected && player.alive && targetIndex !== this.currentShooter);
    if (validTargets.length < 2) {
      this.statusText?.setText('Double Peeranki needs two different living targets.');
      return;
    }
    this.pendingDoubleTarget = index;
    if (offlineMode || amHost()) this.applyWeaponEffect(index, 'peeranki', this.currentShooter);
    this.statusText?.setText(`${target.name} is the first target. Choose a different second target.`);
    return;
  }

  if (this.selectedWeapon === 'doublePeeranki' && this.pendingDoubleTarget >= 0) {
    if (index === this.pendingDoubleTarget) {
      this.statusText?.setText('Choose a different second target.');
      return;
    }
    const first = players[this.pendingDoubleTarget];
    if (!first?.connected || !first.alive || !target.connected || !target.alive) {
      this.pendingDoubleTarget = -1;
      this.statusText?.setText('The targets changed. Select two living targets again.');
      return;
    }
    const firstTarget = this.pendingDoubleTarget;
    this.pendingDoubleTarget = -1;
    if (!offlineMode && !amHost()) {
      void this.requestHostAction([firstTarget, index]);
      return;
    }
    this.applyWeaponEffect(index, 'gun', this.currentShooter);
    this.completePlayerShot(firstTarget);
    return;
  }

  if (!offlineMode && !amHost()) {
    void this.requestHostAction([index]);
    return;
  }

  this.applyWeaponEffect(index, this.selectedWeapon, this.currentShooter);
  this.completePlayerShot(index);
}

private applyWeaponEffect(index: number, weapon: WeaponType, attackerIndex: number) {
  const target = players[index];
  if (!target || !target.alive) return;
  const attacker = players[attackerIndex];
  PeerankiAudio.effect('shoot');

  if (weapon === 'hook') {
    if (target.weapons.includes('shield') && target.shieldDisabledRound !== matchRound) {
      target.weapons = target.weapons.filter((item) => item !== 'shield');
      PeerankiAudio.effect('hit');
      this.statusText?.setText(`${target.name}'s Shield was destroyed permanently!`);
      const targetCard = this.playerObjects[index];
      if (targetCard) this.tweens.add({ targets: targetCard, angle: { from: -5, to: 5 }, alpha: { from: 0.45, to: 1 }, duration: 90, yoyo: true, repeat: 2, onComplete: () => targetCard.setAngle(0) });
    } else {
      this.statusText?.setText(`${target.name} has no Shield for Hook to destroy.`);
    }
    this.updatePlayerVisual(index);
    this.refreshWeaponPicker();
    return;
  }

  const hasShield = target.weapons.includes('shield') && target.shieldDisabledRound !== matchRound;
  if (hasShield && (weapon === 'gun' || weapon === 'peeranki')) {
    PeerankiAudio.effect('hit');
    if (weapon === 'peeranki') {
      target.shieldDisabledRound = matchRound;
      this.statusText?.setText(`${target.name}'s Shield was destroyed for this round.`);
      const targetCard = this.playerObjects[index];
      if (targetCard) this.tweens.add({ targets: targetCard, alpha: { from: 0.35, to: 1 }, duration: 110, yoyo: true, repeat: 2 });
    } else {
      this.statusText?.setText(`${target.name}'s Shield blocked the Gun shot.`);
    }
    this.updatePlayerVisual(index);
    return;
  }

  if (weapon === 'peeranki') {
    target.stage = 3;
    target.alive = false;
    PeerankiAudio.effect('elimination');
  } else {
    PeerankiAudio.effect('hit');
    target.stage += 1;
    if (target.stage >= 3) {
      target.stage = 3;
      target.alive = false;
      PeerankiAudio.effect('elimination');
    }
  }
  if (!target.alive && attacker && attacker.id !== target.id &&
      (attacker.hasCollectedAllWeapons || WEAPON_ORDER.every((ownedWeapon) => attacker.weapons.includes(ownedWeapon)))) {
    attacker.eliminationPoints += 1;
    this.updatePlayerVisual(attackerIndex);
  }
  this.updatePlayerVisual(index);
}

private completePlayerShot(index: number) {
  this.stopActionClock();
  shootingDeadlineAt = '';
  players.forEach((player) => { player.actionRequest = null; });
  this.roundPhase = 'waiting';
  const target = players[index];
  if (!target) return;
  const hitContainer = this.playerObjects[index];
  if (hitContainer) {
    this.tweens.killTweensOf(hitContainer);
    this.tweens.add({ targets: hitContainer, scale: 1.12, angle: 2, duration: 90, yoyo: true, repeat: 1,
      onComplete: () => { hitContainer.setAngle(0); if (this.currentShooter === index) this.updatePlayerVisual(index); },
    });
  }

 this.updatePlayerVisual(index);

if (activePlayers().filter((player) => player.alive).length === 2 && (offlineMode || amHost())) {
  this.beginDuel();
  return;
}

if (offlineMode) {
  const targetContainer =
    this.playerObjects[index];

  if (targetContainer) {
    targetContainer.setScale(1.12);

    this.time.delayedCall(180, () => {
      targetContainer.setScale(1);
    });
  }

  this.shooterText?.setText(
    `💥 ${target.name} was shot!`,
  );
    if (!target.alive) {
      this.statusText?.setText(
        `${target.name} has been eliminated! 💥`,
      );
    } else if (target.stage === 1) {
      this.statusText?.setText(
        `${target.name} split into two small towers!`,
      );
    } else if (target.stage === 2) {
      this.statusText?.setText(
        `${target.name} has one tower remaining!`,
      );
    }

    const alivePlayers = players.filter(
      (player) => player.alive,
    );

    if (alivePlayers.length <= 1) {
      this.time.delayedCall(250, () => void this.finishRound());
      return;
    }

    const nextStartIndex =
  this.getNextCountingStartIndex(index);

this.time.delayedCall(1200, () => {
  this.startCounting(
    nextStartIndex >= 0
      ? nextStartIndex
      : undefined,
  );
});

    return;
  }

// Online mode
this.nextStartIndex =
  this.getNextCountingStartIndex(index);

void this.recordShot();
}

  private async recordShot() {
    const alive = activePlayers().filter(
      (player) => player.alive,
    );

    if (alive.length <= 1) {
      if (!offlineMode && !amHost()) {
        await syncGameState(this.currentShooter, COUNT_TO, 'shot');
        return;
      }
      await this.finishRound();
      return;
    }

    await syncGameState(
      this.currentShooter,
      COUNT_TO,
      'shot',
    );
  }

  private refreshWeaponPicker() {
    const localIndex = offlineMode ? 0 : myPlayerId - 1;
    const owned = players[localIndex]?.weapons ?? ['gun'];
    const options = ACTIVE_WEAPONS.filter((weapon) => owned.includes(weapon));
    if (!options.includes(this.selectedWeapon)) this.selectedWeapon = options[0] ?? 'gun';
    this.weaponImage?.setTexture(`weapon-${this.selectedWeapon}`);
    this.weaponText?.setText(WEAPON_NAMES[this.selectedWeapon]);
  }

  private refreshPreviousRoundText() {
    this.previousRoundText?.setText(lastRoundMessage ? `Previous round: ${lastRoundMessage}` : '');
  }

  private cycleWeapon(direction: number) {
    if (this.gameFinished || this.matchTimeExpired() || this.roundPhase !== 'shooting') return;
    const localIndex = offlineMode ? 0 : myPlayerId - 1;
    if (this.currentShooter !== localIndex || this.currentShooter < 0) return;
    const owned = players[localIndex]?.weapons ?? ['gun'];
    const options = ACTIVE_WEAPONS.filter((weapon) => owned.includes(weapon));
    const current = Math.max(0, options.indexOf(this.selectedWeapon));
    this.selectedWeapon = options[(current + direction + options.length) % options.length] ?? 'gun';
    this.pendingDoubleTarget = -1;
    this.refreshWeaponPicker();
  }

  private matchTimeExpired() {
    const startedAt = Date.parse(matchStartedAt);
    return matchOver || (Number.isFinite(startedAt) && Date.now() >= startedAt + matchDurationMs());
  }

  private startMatchClock() {
    if (!matchStartedAt) matchStartedAt = new Date().toISOString();
    if (this.matchTimer) return;
    const update = () => {
      const elapsed = Math.max(0, Date.now() - Date.parse(matchStartedAt));
      const remaining = Math.max(0, matchDurationMs() - elapsed);
      const seconds = Math.ceil(remaining / 1000);
      this.matchText?.setText(`MATCH ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} • ROUND ${matchRound}`);
      if (remaining === 0 && (offlineMode || amHost()) && !this.gameFinished) void this.finishMatch();
    };
    update();
    this.matchTimer = this.time.addEvent({ delay: 250, loop: true, callback: update });
  }

  private async finishRound(winnerMessage?: string) {
    if (this.gameFinished || this.matchTimeExpired() || (!offlineMode && !amHost())) {
      if (this.matchTimeExpired() && (offlineMode || amHost())) await this.finishMatch();
      return;
    }
    const winner = activePlayers().find((player) => player.alive);
    if (!winner) { await this.finishMatch(); return; }
    const upgrade = nextWeaponUpgrade(winner.weapons, matchRound);
    let message = winnerMessage ?? `${winner.name} wins Round ${matchRound}!`;
    if (upgrade) {
      winner.weapons = normalizeWeapons([...winner.weapons, upgrade]);
      message += ` Earned ${WEAPON_LABELS[upgrade]}.`;
    } else {
      message += ' No new weapon unlocked this round.';
    }
    if (WEAPON_ORDER.every((weapon) => winner.weapons.includes(weapon))) winner.hasCollectedAllWeapons = true;
    lastRoundMessage = message;
    this.refreshPreviousRoundText();
    roundWinnerId = winner.id;
    matchRound += 1;
    players.forEach((player) => {
      player.stage = 0;
      player.alive = player.connected;
      player.shieldDisabledRound = -1;
      player.matchStartedAt = matchStartedAt;
      player.matchRound = matchRound;
      player.countingStartIndex = -1;
      player.roundWinnerId = roundWinnerId;
      player.matchOver = false;
    });
    this.currentShooter = -1;
    this.roundPhase = 'waiting';
    this.duelActive = false;
    this.resolvingDuel = false;
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();
    duelRound = 1;
    players.forEach((player) => {
      player.duelChoice = null;
      player.duelChoiceRequest = null;
    });
    countingStartIndex = -1;
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.pendingDoubleTarget = -1;
    this.shooterText?.setText(message);
    this.statusText?.setText('Preparing the next round...');
    this.refreshWeaponPicker();
    this.renderPlayers();
    const winnerIndex = players.findIndex((player) => player.id === winner.id);
    const winnerCard = this.playerObjects[winnerIndex];
    if (winnerCard) this.tweens.add({ targets: winnerCard, scale: { from: 1, to: 1.12 }, duration: 300, yoyo: true, repeat: 2, ease: 'Back.Out' });
    if (!offlineMode) await syncGameState(null, 0, 'round_won');
    this.markShooter();
    if (!this.nextRoundTimer) {
      this.nextRoundTimer = this.time.delayedCall(NEXT_ROUND_DELAY, () => {
        this.nextRoundTimer = undefined;
        this.startCounting();
      });
    }
  }

  private async finishMatch() {
    if (this.gameFinished || (!offlineMode && !amHost())) return;
    this.gameFinished = true;
    this.duelActive = false;
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();
    this.stopActionClock();
    shootingDeadlineAt = '';
    this.roundPhase = 'finished';
    matchOver = true;
    players.forEach((player) => { player.matchOver = true; });
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.nextRoundTimer?.remove(false);
    this.nextRoundTimer = undefined;
    const topCount = Math.max(0, ...connectedPlayers().map((player) => player.weapons.length));
    const winners = connectedPlayers().filter((player) => player.weapons.length === topCount);
    if (!offlineMode) await syncGameState(this.currentShooter >= 0 ? this.currentShooter : null, this.countNumber, 'finished');
    this.showFinishedState(winners, topCount);
  }

  private isGameFinished() {
    return (
      activePlayers().filter(
        (player) => player.alive,
      ).length <= 1
    );
  }

 private showFinishedState(
  finalists = connectedPlayers(),
  weaponCount?: number,
) {
  this.duelActive = false;
  this.duelBotTimer?.remove(false);
  this.duelBotTimer = undefined;
  this.clearDuelControls();
  this.stopActionClock();
  shootingDeadlineAt = '';

  if (!this.victoryPlayed) {
    this.victoryPlayed = true;
    PeerankiAudio.effect('victory');
  }

  this.gameFinished = true;

  const connected = connectedPlayers();

  const topCount =
    weaponCount ??
    Math.max(
      0,
      ...connected.map(
        (player) => player.weapons.length,
      ),
    );

  const winners = finalists.filter(
    (player) => player.weapons.length === topCount,
  );

  const { width, height } = this.scale;

  this.matchTimer?.remove(false);
  this.matchTimer = undefined;

  this.countText?.setText(
    `🏆 ${matchDurationMinutes}-MINUTE MATCH OVER`,
  );

  this.shooterText?.setText('');
  this.statusText?.setText('');

  if (this.children.getByName('game-over-panel')) {
    return;
  }

  /*
   * WINNER OVERLAY
   * Designed to remain readable on desktop and Android.
   */

  const panel = this.add
    .container(
      width / 2,
      height / 2,
    )
    .setName('game-over-panel')
    .setDepth(1000);

  const panelWidth = Math.min(
    width * 0.88,
    700,
  );

  const panelHeight = Math.min(
    height * 0.82,
    540,
  );

  // Dark background covering the game.
  const overlay = this.add.rectangle(
    0,
    0,
    width,
    height,
    0x000000,
    0.58,
  );

  // Main winner card.
  const card = this.add.rectangle(
    0,
    0,
    panelWidth,
    panelHeight,
    0x17212b,
    0.98,
  ).setStrokeStyle(
    4,
    0xf2cf66,
  );

  // Trophy.
  const trophy = this.add.text(
    0,
    -panelHeight / 2 + 58,
    '🏆',
    {
      fontFamily: 'Arial',
      fontSize: '56px',
    },
  ).setOrigin(0.5);

  // WINNER heading.
  const winnerHeading = this.add.text(
    0,
    -panelHeight / 2 + 118,
    winners.length === 1
      ? 'WINNER'
      : 'MATCH TIE',
    {
      fontFamily: 'Arial',
      fontSize: '34px',
      color: '#f2cf66',
      fontStyle: 'bold',
      align: 'center',
    },
  ).setOrigin(0.5);

  // Winner name.
  const winnerName = this.add.text(
    0,
    -panelHeight / 2 + 168,
    winners.length === 1
      ? winners[0].name
      : winners.map(
          (player) => player.name,
        ).join('  •  '),
    {
      fontFamily: 'Arial',
      fontSize: winners.length === 1
        ? '38px'
        : '26px',
      color: '#ffffff',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: {
        width: panelWidth - 60,
      },
    },
  ).setOrigin(0.5);

  // Main score.
  const weaponScore = this.add.text(
    0,
    -panelHeight / 2 + 235,
    `⭐ ${topCount}/5 WEAPONS`,
    {
      fontFamily: 'Arial',
      fontSize: '25px',
      color: '#ffffff',
      fontStyle: 'bold',
      align: 'center',
    },
  ).setOrigin(0.5);

  // Winner details.
  const winnerDetails = winners.length === 1
    ? `${winners[0].weapons.length}/5 weapons collected`
    : `${winners.length} players finished with ${topCount}/5 weapons`;

  const details = this.add.text(
    0,
    -panelHeight / 2 + 278,
    winnerDetails,
    {
      fontFamily: 'Arial',
      fontSize: '18px',
      color: '#cfd8dc',
      align: 'center',
    },
  ).setOrigin(0.5);

  // Player results.
  const results = connected
    .map(
      (player) =>
        `${player.name}   •   ${player.weapons.length}/5 weapons`,
    )
    .join('\n');

  const resultsText = this.add.text(
    0,
    -panelHeight / 2 + 335,
    results,
    {
      fontFamily: 'Arial',
      fontSize: '16px',
      color: '#ffffff',
      align: 'center',
      lineSpacing: 6,
      wordWrap: {
        width: panelWidth - 70,
      },
    },
  ).setOrigin(0.5, 0);

  // Buttons.
  const buttonY = panelHeight / 2 - 48;

  const replay = makeButton(
    this,
    -105,
    buttonY,
    'PLAY AGAIN',
    '#20a060',
    17,
  );

  const menu = makeButton(
    this,
    105,
    buttonY,
    'MAIN MENU',
    '#2878ff',
    17,
  );

  panel.add([
    overlay,
    card,
    trophy,
    winnerHeading,
    winnerName,
    weaponScore,
    details,
    resultsText,
    replay,
    menu,
  ]);

  /*
   * Winner entrance animation.
   */
  panel.setAlpha(0);
  panel.setScale(0.82);

  this.tweens.add({
    targets: panel,
    alpha: 1,
    scale: 1,
    duration: 500,
    ease: 'Back.Out',
  });

  /*
   * Trophy animation.
   */
  this.tweens.add({
    targets: trophy,
    scale: {
      from: 0.85,
      to: 1.15,
    },
    duration: 700,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.InOut',
  });

  /*
   * Play Again.
   */
  replay.on(
    'pointerdown',
    () => {
      this.shutdown();

      if (offlineMode) {
        this.scene.start(
          'OfflineSetupScene',
        );
      } else {
        void leaveCurrentRoom();
        this.scene.start(
          'OnlineModeScene',
        );
      }
    },
  );

  /*
   * Main Menu.
   */
  menu.on(
    'pointerdown',
    () => {
      this.shutdown();

      if (offlineMode) {
        offlineMode = false;
        players = [];
      } else {
        void leaveCurrentRoom();
      }

      this.scene.start(
        'MenuScene',
      );
    },
  );

  this.markShooter();
}
  shutdown() {
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.matchTimer?.remove(false);
    this.matchTimer = undefined;
    this.stopActionClock();
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();

    this.nextRoundTimer?.remove(false);
    this.nextRoundTimer = undefined;

    if (this.realtimeChannel) {
      void this.realtimeChannel.unsubscribe();
      this.realtimeChannel = undefined;
    }
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 900,
  height: 700,
  backgroundColor: '#101418',
  parent: 'game',

  input: {
    activePointers: 2,
  },

  scene: [
    MenuScene,
    SettingsScene,
    OnlineModeScene,
    OfflineSetupScene,
    FriendsScene,
    PlayerCountScene,
    JoinScene,
    LobbyScene,
    GameScene,
  ],

  scale: {
    mode: Capacitor.getPlatform() === 'android'
      ? Phaser.Scale.EXPAND
      : Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

window.peerankiDesktop?.onFullscreenChange((fullscreen) => {
  const settings = loadSettings();
  settings.fullscreen = fullscreen;
  saveSettings(settings);
});
void window.peerankiDesktop?.setFullscreen(loadSettings().fullscreen);

new Phaser.Game(config);
