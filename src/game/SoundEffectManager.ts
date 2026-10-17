import type { WeaponType } from './rules.ts';

/**
 * SoundEffectManager
 *
 * Dedicated game engine audio feedback manager that triggers specific
 * zero-latency audio clips and procedural sound synthesis for gameplay events
 * (shooting, tower damage, duel resolution, and match completion).
 */

export type SoundEffectType =
  | 'shoot'
  | 'cannon'
  | 'double_peeranki'
  | 'hook'
  | 'hit'
  | 'tower_damage'
  | 'tower_destroyed'
  | 'elimination'
  | 'shield_hit'
  | 'hook_strip'
  | 'duel_start'
  | 'rps_clash'
  | 'rps_tie'
  | 'rps_win'
  | 'round_win'
  | 'victory'
  | 'defeat'
  | 'shooter_selected'
  | 'weapon_upgrade'
  | 'timer_tick';

export interface SoundEffectOptions {
  volume?: number; // 0.0 to 1.0 override
  detune?: number; // Cents detune
  rate?: number; // Playback rate
}

const SETTINGS_KEY = 'peeranki-settings';
const MUTE_KEY = 'peeranki_music_muted';

/**
 * Sound clip asset candidates mapped to their primary and fallback audio files.
 */
const SFX_CLIP_MAP: Record<string, string[]> = {
  shoot: ['/assets/audio/shoot.wav', '/assets/audio/shoot.mp3'],
  cannon: ['/assets/audio/cannon.wav', '/assets/audio/cannon.mp3'],
  double_peeranki: ['/assets/audio/double_peeranki.wav', '/assets/audio/double_peeranki.mp3'],
  hook: ['/assets/audio/hook.wav', '/assets/audio/hook.mp3'],
  hit: ['/assets/audio/hit.wav', '/assets/audio/hit.mp3'],
  tower_damage: ['/assets/audio/hit.wav', '/assets/audio/hit.mp3'],
  tower_destroyed: ['/assets/audio/elimination.wav', '/assets/audio/elimination.mp3'],
  elimination: ['/assets/audio/elimination.wav', '/assets/audio/elimination.mp3'],
  hook_strip: ['/assets/audio/hook_strip.wav', '/assets/audio/hook_strip.mp3'],
  duel_start: ['/assets/audio/duel_start.wav', '/assets/audio/duel_start.mp3'],
  rps_clash: ['/assets/audio/rps_clash.wav', '/assets/audio/rps_clash.mp3'],
  rps_tie: ['/assets/audio/rps_tie.mp3'],
  rps_win: ['/assets/audio/round_win.wav', '/assets/audio/round_win.mp3', '/assets/audio/victory.wav'],
  round_win: ['/assets/audio/round_win.wav', '/assets/audio/round_win.mp3'],
  victory: ['/assets/audio/victory.wav', '/assets/audio/victory.mp3'],
  defeat: ['/assets/audio/defeat.wav', '/assets/audio/defeat.mp3'],
  count_tick: ['/assets/audio/count_tick.wav', '/assets/audio/count_tick.mp3'],
};

export class SoundEffectManager {
  private static instance?: SoundEffectManager;

  private context?: AudioContext;
  private sfxGain?: GainNode;
  private bufferCache = new Map<string, AudioBuffer>();
  private pendingFetches = new Set<string>();
  private unlocked = false;

  public static getInstance(): SoundEffectManager {
    if (!SoundEffectManager.instance) {
      SoundEffectManager.instance = new SoundEffectManager();
    }
    return SoundEffectManager.instance;
  }

  constructor() {
    this.setupUnlockListeners();
    this.preloadCoreClips();
  }

  private setupUnlockListeners(): void {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;

      const ctx = this.getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
    };

    const gestures = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];
    gestures.forEach((gesture) => {
      window.addEventListener(gesture, unlock, { capture: true, passive: true, once: true });
    });
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.context) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;

      this.context = new AudioCtx();
      this.sfxGain = this.context.createGain();
      this.sfxGain.connect(this.context.destination);
      this.syncVolume();
    }

    return this.context;
  }

  public syncVolume(): void {
    if (!this.context || !this.sfxGain) return;
    const isMuted = this.isMuted();
    const volumePercent = isMuted ? 0 : this.getStoredVolume();
    const targetGain = (volumePercent / 100) * 0.45;
    const now = this.context.currentTime;
    this.sfxGain.gain.setTargetAtTime(targetGain, now, 0.03);
  }

  public getStoredVolume(): number {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.soundEffectsVolume === 'number') {
          return Math.max(0, Math.min(100, parsed.soundEffectsVolume));
        }
      }
    } catch {
      // fallback
    }
    return 80;
  }

  public setVolume(volume: number): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.soundEffectsVolume = Math.max(0, Math.min(100, volume));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
    } catch {
      // ignore
    }
    this.syncVolume();
  }

  public isMuted(): boolean {
    try {
      const storedMute = localStorage.getItem(MUTE_KEY);
      if (storedMute !== null) return storedMute === 'true';
      const settings = localStorage.getItem(SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        if (typeof parsed.muted === 'boolean') return parsed.muted;
      }
    } catch {
      // ignore
    }
    return false;
  }

  public setMuted(muted: boolean): void {
    try {
      localStorage.setItem(MUTE_KEY, String(muted));
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.muted = muted;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
      }
    } catch {
      // ignore
    }
    this.syncVolume();
  }

  /**
   * Preloads essential audio clips into decoded Web Audio buffers for instant 0ms playback.
   */
  public async preloadCoreClips(): Promise<void> {
    if (typeof window === 'undefined') return;

    const coreClips = [
      'shoot',
      'cannon',
      'double_peeranki',
      'hook',
      'hit',
      'elimination',
      'hook_strip',
      'duel_start',
      'rps_clash',
      'rps_tie',
      'round_win',
      'victory',
      'defeat',
    ];

    for (const clipName of coreClips) {
      void this.loadClipBuffer(clipName);
    }
  }

  private async loadClipBuffer(clipName: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(clipName)) {
      return this.bufferCache.get(clipName)!;
    }
    if (this.pendingFetches.has(clipName)) {
      return null;
    }

    const candidates = SFX_CLIP_MAP[clipName];
    if (!candidates || candidates.length === 0) return null;

    this.pendingFetches.add(clipName);

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return null;

      for (const url of candidates) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const decoded = await ctx.decodeAudioData(arrayBuffer);
            this.bufferCache.set(clipName, decoded);
            return decoded;
          }
        } catch {
          // Try next candidate URL
        }
      }
    } finally {
      this.pendingFetches.delete(clipName);
    }

    return null;
  }

  /**
   * Low-level clip playback with zero-latency buffer playback and procedural synth fallback.
   */
  public playClip(clipName: SoundEffectType, options?: SoundEffectOptions): void {
    if (this.isMuted()) return;
    const vol = this.getStoredVolume();
    if (vol === 0) return;

    const ctx = this.getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }

    // Check if buffer is already decoded in memory
    const buffer = this.bufferCache.get(clipName);
    if (buffer && this.sfxGain) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;

        if (typeof options?.rate === 'number' && options.rate > 0) {
          source.playbackRate.value = options.rate;
        }
        if (typeof options?.detune === 'number') {
          source.detune.value = options.detune;
        }

        if (typeof options?.volume === 'number' && options.volume !== 1) {
          const clipGain = ctx.createGain();
          clipGain.gain.value = options.volume;
          source.connect(clipGain);
          clipGain.connect(this.sfxGain);
        } else {
          source.connect(this.sfxGain);
        }

        source.start(0);
        return;
      } catch {
        // Fall back to synthesizer if audio buffer source error occurs
      }
    }

    // If buffer is not yet available, play procedural synthesized fallback immediately
    this.playProceduralFallback(clipName);

    // And asynchronously load the buffer for future triggers
    if (!this.bufferCache.has(clipName)) {
      void this.loadClipBuffer(clipName);
    }
  }

  // ==========================================================================
  // High-Level Gameplay Action Sound Triggers
  // ==========================================================================

  /**
   * Triggers the appropriate audio clip for a weapon firing action.
   */
  public playShoot(weapon: WeaponType): void {
    switch (weapon) {
      case 'peeranki':
        this.playClip('cannon');
        break;
      case 'doublePeeranki':
        this.playClip('double_peeranki');
        break;
      case 'hook':
        this.playClip('hook');
        break;
      case 'gun':
      default:
        this.playClip('shoot');
        break;
    }
  }

  /**
   * Triggers the appropriate audio clip for tower damage or shield interaction.
   */
  public playTowerDamage(result?: {
    action?: string;
    shieldRemoved?: boolean;
    eliminated?: boolean;
    stage?: number;
  }): void {
    if (!result) {
      this.playClip('hit');
      return;
    }

    if (result.eliminated) {
      this.playClip('tower_destroyed');
    } else if (result.shieldRemoved) {
      this.playClip('hook_strip');
    } else if (result.action === 'shield_absorbed' || result.action === 'shield_destroyed_for_round') {
      this.playClip('shield_hit');
    } else {
      this.playClip('hit');
    }
  }

  /**
   * Triggers the duel start gong/chime.
   */
  public playDuelStart(): void {
    this.playClip('duel_start');
  }

  /**
   * Triggers the clash sound when duel choices are revealed.
   */
  public playDuelClash(): void {
    this.playClip('rps_clash');
  }

  /**
   * Triggers the tie sound when contestants pick the same duel choice.
   */
  public playDuelTie(): void {
    this.playClip('rps_tie');
  }

  /**
   * Triggers the victory flourish when a contestant wins the Rock-Paper-Scissors duel.
   */
  public playDuelWin(): void {
    this.playClip('rps_win');
  }

  /**
   * Triggers the round victory fanfare.
   */
  public playRoundWin(): void {
    this.playClip('round_win');
  }

  /**
   * Triggers the overall match victory celebration audio.
   */
  public playMatchVictory(): void {
    this.playClip('victory');
  }

  /**
   * Triggers the player defeat audio.
   */
  public playMatchDefeat(): void {
    this.playClip('defeat');
  }

  /**
   * Triggers weapon upgrade unlock audio.
   */
  public playWeaponUpgrade(): void {
    this.playClip('weapon_upgrade');
  }

  /**
   * Triggers shooter selection fanfare upon completing count 10.
   */
  public playShooterSelected(): void {
    this.playClip('shooter_selected');
  }

  // ==========================================================================
  // Procedural Web Audio Synthesizer Fallbacks
  // ==========================================================================

  private playProceduralFallback(type: string): void {
    const ctx = this.getAudioContext();
    if (!ctx || !this.sfxGain) return;
    const dest = this.sfxGain;

    switch (type) {
      case 'shoot':
        this.synthSweep(480, 80, 0.15, 0.8, dest, 'sawtooth');
        this.synthNoise(0.05, 0.6, dest, 2400);
        break;

      case 'cannon':
        this.synthSweep(220, 35, 0.55, 0.95, dest, 'triangle');
        this.synthNoise(0.4, 0.85, dest, 450);
        break;

      case 'double_peeranki':
        this.synthSweep(240, 42, 0.45, 0.85, dest, 'triangle');
        this.synthNoise(0.35, 0.8, dest, 500);
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            this.synthSweep(200, 34, 0.55, 0.95, dest, 'triangle');
            this.synthNoise(0.45, 0.9, dest, 420);
          }, 120);
        }
        break;

      case 'hit':
      case 'tower_damage':
        this.synthSweep(220, 50, 0.22, 0.75, dest, 'sawtooth');
        this.synthNoise(0.15, 0.55, dest, 800);
        break;

      case 'tower_destroyed':
      case 'elimination':
        this.synthSweep(150, 28, 0.7, 0.95, dest, 'triangle');
        this.synthNoise(0.6, 0.9, dest, 380);
        break;

      case 'shield_hit':
        this.synthTone(1480, 0.25, 0.6, dest, 'sine');
        this.synthTone(2240, 0.2, 0.45, dest, 'triangle');
        this.synthNoise(0.02, 0.3, dest, 3200);
        break;

      case 'hook':
        this.synthSweep(320, 950, 0.24, 0.55, dest, 'sine');
        this.synthNoise(0.2, 0.4, dest, 1600);
        break;

      case 'hook_strip':
        [0, 35, 75, 120].forEach((delay) => {
          if (typeof window !== 'undefined') {
            window.setTimeout(() => {
              this.synthTone(1850 - delay * 3, 0.08, 0.45, dest, 'triangle');
            }, delay);
          }
        });
        this.synthNoise(0.25, 0.6, dest, 1800);
        break;

      case 'duel_start':
        this.synthTone(220, 0.7, 0.6, dest, 'sine');
        this.synthTone(330, 0.5, 0.4, dest, 'triangle');
        break;

      case 'rps_clash':
        this.synthTone(1350, 0.22, 0.65, dest, 'triangle');
        this.synthTone(2700, 0.15, 0.45, dest, 'sine');
        this.synthNoise(0.04, 0.4, dest, 2800);
        break;

      case 'rps_tie':
        this.synthTone(440, 0.16, 0.5, dest, 'sine');
        if (typeof window !== 'undefined') {
          window.setTimeout(() => this.synthTone(440, 0.18, 0.5, dest, 'sine'), 120);
        }
        break;

      case 'rps_win':
      case 'round_win': {
        const fanfare = [440, 554.37, 659.25, 880];
        fanfare.forEach((f, idx) => {
          if (typeof window !== 'undefined') {
            window.setTimeout(() => this.synthTone(f, 0.22, 0.6, dest, 'sawtooth'), idx * 110);
          }
        });
        break;
      }

      case 'victory': {
        const chords = [
          { time: 0, freqs: [523.25, 659.25, 783.99] },
          { time: 240, freqs: [587.33, 739.99, 880.0] },
          { time: 480, freqs: [659.25, 830.61, 987.77] },
          { time: 750, freqs: [783.99, 987.77, 1046.5, 1318.51] },
        ];
        chords.forEach(({ time, freqs }) => {
          if (typeof window !== 'undefined') {
            window.setTimeout(() => {
              freqs.forEach((f) => this.synthTone(f, 0.4, 0.45 / freqs.length, dest, 'sine'));
            }, time);
          }
        });
        break;
      }

      case 'defeat':
        this.synthSweep(440, 220, 0.5, 0.65, dest, 'sawtooth');
        this.synthSweep(330, 165, 0.6, 0.5, dest, 'triangle');
        break;

      case 'shooter_selected': {
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((f, idx) => {
          if (typeof window !== 'undefined') {
            window.setTimeout(() => this.synthTone(f, 0.18, 0.6, dest, 'sawtooth'), idx * 85);
          }
        });
        break;
      }

      case 'weapon_upgrade': {
        const harp = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51];
        harp.forEach((f, idx) => {
          if (typeof window !== 'undefined') {
            window.setTimeout(() => this.synthTone(f, 0.22, 0.45, dest, 'sine'), idx * 75);
          }
        });
        break;
      }

      default:
        break;
    }
  }

  private synthTone(
    freq: number,
    duration: number,
    gainValue: number,
    destination: AudioNode,
    type: OscillatorType = 'sine',
  ): void {
    if (!this.context) return;
    try {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const now = this.context.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gainValue, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(now + duration + 0.05);
    } catch {
      // ignore
    }
  }

  private synthSweep(
    startFreq: number,
    endFreq: number,
    duration: number,
    gainValue: number,
    destination: AudioNode,
    type: OscillatorType = 'sawtooth',
  ): void {
    if (!this.context) return;
    try {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const now = this.context.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now + duration);
      gain.gain.setValueAtTime(gainValue, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(now + duration + 0.05);
    } catch {
      // ignore
    }
  }

  private synthNoise(duration: number, gainValue: number, destination: AudioNode, cutoff = 1200): void {
    if (!this.context) return;
    try {
      const bufferSize = Math.floor(this.context.sampleRate * duration);
      const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.context.createBufferSource();
      noise.buffer = buffer;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const gain = this.context.createGain();
      const now = this.context.currentTime;
      gain.gain.setValueAtTime(gainValue, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      noise.start(now);
      noise.stop(now + duration + 0.05);
    } catch {
      // ignore
    }
  }
}

export const soundEffectManager = SoundEffectManager.getInstance();
