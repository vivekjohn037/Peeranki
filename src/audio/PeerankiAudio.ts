// Peeranki Audio System
// High-fidelity audio engine with zero-latency Web Audio buffer playback,
// real-time procedural synthesizers, and HTML5 audio fallbacks.

const SETTINGS_KEY = 'peeranki-settings';
const MUTE_KEY = 'peeranki_music_muted';
const TRACK_KEY = 'peeranki_selected_track';

export interface SoundtrackTrack {
  id: 1 | 2;
  title: string;
  filename: string;
  sources: string[];
}

export const SOUNDTRACK_TRACKS: SoundtrackTrack[] = [
  {
    id: 1,
    title: 'Peeranki Main Theme',
    filename: 'bg_music.mp3',
    sources: [
      '/assets/audio/bg_music.mp3',
      '/assets/audio/bg_music_1.mp3',
      '/assets/audio/bg_music.wav',
    ],
  },
  {
    id: 2,
    title: 'Kerala Folk Battle Theme',
    filename: 'bg_music_2.mp3',
    sources: [
      '/assets/audio/bg_music_2.mp3',
      '/assets/audio/bg_music.mp3',
    ],
  },
];

export type PeerankiAudioEffect =
  | 'click'
  | 'select'
  | 'shoot'
  | 'cannon'
  | 'peeranki'
  | 'double_peeranki'
  | 'hit'
  | 'shield_hit'
  | 'hook'
  | 'hook_strip'
  | 'tower_damage'
  | 'tower_destroyed'
  | 'elimination'
  | 'count_tick'
  | 'shooter_selected'
  | 'timer_tick'
  | 'duel_start'
  | 'rps_clash'
  | 'rps_tie'
  | 'rps_win'
  | 'weapon_upgrade'
  | 'round_win'
  | 'victory'
  | 'defeat';

// Keep this list aligned with the files shipped in public/assets/audio.
// Missing samples use the procedural effect synthesizer without network requests.
const SFX_ASSET_EXTENSIONS: Partial<Record<PeerankiAudioEffect, 'wav' | 'mp3'>> = {
  click: 'wav',
  select: 'wav',
  shoot: 'wav',
  cannon: 'wav',
  double_peeranki: 'wav',
  hit: 'wav',
  hook: 'wav',
  hook_strip: 'wav',
  elimination: 'wav',
  count_tick: 'wav',
  duel_start: 'wav',
  rps_clash: 'wav',
  rps_tie: 'mp3',
  round_win: 'wav',
  victory: 'wav',
  defeat: 'wav',
};

function getStoredMusicVolume(): number {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.musicVolume === 'number') return Math.max(0, Math.min(100, parsed.musicVolume));
    }
  } catch {
    // fallback
  }
  return 70;
}

function getStoredSfxVolume(): number {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.soundEffectsVolume === 'number') return Math.max(0, Math.min(100, parsed.soundEffectsVolume));
    }
  } catch {
    // fallback
  }
  return 80;
}

function getStoredTrack(): 1 | 2 {
  try {
    const raw = localStorage.getItem(TRACK_KEY);
    if (raw === '2') return 2;
  } catch {
    // ignore
  }
  return 1;
}

export type MusicMode = 'both' | 'track1' | 'track2';

export class PeerankiAudioSystem {
  private context?: AudioContext;
  private musicGain?: GainNode;
  private effectsGain?: GainNode;
  private musicTimer?: number;
  private musicStep = 0;

  private currentTrackId: 1 | 2 = 1;
  private audioElement: HTMLAudioElement | null = null;
  private currentSourceIndex = 0;
  private isHtmlAudioPlaying = false;
  private hasPendingAutoplay = false;
  private unlocked = false;
  private onTrackChangeCallbacks = new Set<() => void>();

  // Decoded Web Audio buffers for instant playback
  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private pendingBufferFetches: Set<string> = new Set();

  constructor() {
    this.currentTrackId = getStoredTrack();
    this.setupUserInteractionUnlock();
    this.preloadSFX();
  }

  private setupUserInteractionUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      if (this.unlocked && (!this.hasPendingAutoplay || this.isHtmlAudioPlaying)) return;
      this.unlocked = true;

      // Resume Web Audio Context if suspended
      if (this.context && this.context.state === 'suspended') {
        void this.context.resume().catch(() => undefined);
      } else if (!this.context) {
        this.getContext();
      }

      // If background music should be playing, start it now that user has interacted
      if (this.hasPendingAutoplay && !this.isMuted()) {
        this.hasPendingAutoplay = false;
        this.startMusic();
      }
    };

    const events = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];
    const handleEvent = () => {
      unlock();
    };

    events.forEach((ev) => {
      window.addEventListener(ev, handleEvent, { capture: true, passive: true });
    });
  }

  private preloadSFX() {
    if (typeof window === 'undefined') return;

    const sfxNames: PeerankiAudioEffect[] = [
      'click',
      'select',
      'shoot',
      'cannon',
      'double_peeranki',
      'hit',
      'shield_hit',
      'hook',
      'hook_strip',
      'tower_damage',
      'tower_destroyed',
      'elimination',
      'count_tick',
      'shooter_selected',
      'timer_tick',
      'duel_start',
      'rps_clash',
      'rps_tie',
      'rps_win',
      'weapon_upgrade',
      'round_win',
      'victory',
      'defeat',
    ];

    sfxNames.forEach((name) => {
      this.loadAudioBuffer(name);
    });
  }

  private async loadAudioBuffer(name: string): Promise<AudioBuffer | null> {
    if (this.audioBufferCache.has(name)) {
      return this.audioBufferCache.get(name)!;
    }
    if (this.pendingBufferFetches.has(name)) {
      return null;
    }

    const extension = SFX_ASSET_EXTENSIONS[name as PeerankiAudioEffect];
    if (!extension) return null;

    this.pendingBufferFetches.add(name);
    try {
      const response = await fetch(`/assets/audio/${name}.${extension}`);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const ctx = this.getContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        this.audioBufferCache.set(name, decoded);
        return decoded;
      }
    } catch {
      // Procedural effects remain available when an audio file cannot be loaded.
    } finally {
      this.pendingBufferFetches.delete(name);
    }
    return null;
  }

  public onTrackChange(callback: () => void): () => void {
    this.onTrackChangeCallbacks.add(callback);
    return () => this.onTrackChangeCallbacks.delete(callback);
  }

  private notifyChange() {
    this.onTrackChangeCallbacks.forEach((cb) => {
      try {
        cb();
      } catch {
        // ignore
      }
    });
  }

  public getCurrentTrack(): 1 | 2 {
    return this.currentTrackId;
  }

  public getCurrentTrackTitle(): string {
    const track = SOUNDTRACK_TRACKS.find((t) => t.id === this.currentTrackId) || SOUNDTRACK_TRACKS[0];
    return track.title;
  }

  public getCurrentTrackFilename(): string {
    const track = SOUNDTRACK_TRACKS.find((t) => t.id === this.currentTrackId) || SOUNDTRACK_TRACKS[0];
    return track.filename;
  }

  public getPermanentSongName(): string {
    return this.getCurrentTrackTitle();
  }

  public setTrack(trackId: 1 | 2) {
    if (this.currentTrackId === trackId && this.audioElement) return;
    this.currentTrackId = trackId;
    try {
      localStorage.setItem(TRACK_KEY, String(trackId));
    } catch {
      // ignore
    }

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }
    this.isHtmlAudioPlaying = false;
    this.currentSourceIndex = 0;

    if (!this.isMuted()) {
      this.startMusic();
    }
    this.notifyChange();
  }

  public cycleTrack(): 1 | 2 {
    const next = this.currentTrackId === 1 ? 2 : 1;
    this.setTrack(next);
    return next;
  }

  // Backward compatibility stubs
  public getMusicMode(): MusicMode {
    return this.currentTrackId === 1 ? 'track1' : 'track2';
  }

  public setMusicMode(mode: MusicMode) {
    if (mode === 'track2') {
      this.setTrack(2);
    } else {
      this.setTrack(1);
    }
  }

  public cycleMusicMode(): MusicMode {
    const next = this.cycleTrack();
    return next === 1 ? 'track1' : 'track2';
  }

  public isTrackLoaded(_slot: 1 | 2): boolean {
    return true;
  }

  public hasCustomUpload(_slot: 1 | 2): boolean {
    return false;
  }

  public async setCustomTrack(_slot: 1 | 2, _file: File | Blob) {
    return Promise.resolve();
  }

  private getContext(): AudioContext {
    if (!this.context) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new AudioCtx();
      this.musicGain = this.context.createGain();
      this.effectsGain = this.context.createGain();
      this.musicGain.connect(this.context.destination);
      this.effectsGain.connect(this.context.destination);
      this.applySettings();
    }
    return this.context;
  }

  public isMuted(): boolean {
    try {
      const stored = localStorage.getItem(MUTE_KEY);
      if (stored !== null) return stored === 'true';
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
    this.applySettings();
    if (muted) {
      if (this.audioElement) {
        this.audioElement.pause();
      }
      this.stopSynthesizedMusic();
      this.hasPendingAutoplay = false;
    } else {
      this.startMusic();
    }
    this.notifyChange();
  }

  public toggleMute(): boolean {
    const nextState = !this.isMuted();
    this.setMuted(nextState);
    return nextState;
  }

  public applySettings() {
    const isMuted = this.isMuted();
    const musicVol = isMuted ? 0 : getStoredMusicVolume();
    const sfxVol = isMuted ? 0 : getStoredSfxVolume();

    // 1. Update HTML5 Audio background volume
    if (this.audioElement) {
      const volumeRatio = (musicVol / 100) * 0.72;
      this.audioElement.volume = Math.max(0, Math.min(1, volumeRatio));
      if (musicVol === 0 || isMuted) {
        if (!this.audioElement.paused) this.audioElement.pause();
      } else {
        if (this.audioElement.paused && this.isHtmlAudioPlaying) {
          void this.audioElement.play().catch(() => undefined);
        }
      }
    }

    // 2. Update Web Audio volume
    if (this.context) {
      const now = this.context.currentTime;
      this.musicGain?.gain.setTargetAtTime((musicVol / 100) * 0.16, now, 0.04);
      this.effectsGain?.gain.setTargetAtTime((sfxVol / 100) * 0.42, now, 0.04);
    }
  }

  private getCurrentSources(): string[] {
    const track = SOUNDTRACK_TRACKS.find((t) => t.id === this.currentTrackId) || SOUNDTRACK_TRACKS[0];
    return track.sources;
  }

  private tryNextSource() {
    const sources = this.getCurrentSources();
    this.currentSourceIndex += 1;
    if (this.currentSourceIndex < sources.length && this.audioElement) {
      const nextUrl = sources[this.currentSourceIndex];
      this.audioElement.src = nextUrl;
      const playPromise = this.audioElement.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            this.stopSynthesizedMusic();
            this.isHtmlAudioPlaying = true;
          })
          .catch(() => undefined);
      }
    } else {
      // All file sources failed, fallback to gentle synth
      this.startSynthesizedMusic();
    }
  }

  public startMusic() {
    if (this.isMuted()) return;
    const musicVol = getStoredMusicVolume();
    if (musicVol === 0) return;

    if (this.context && this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }

    if (!this.audioElement) {
      const sources = this.getCurrentSources();
      this.currentSourceIndex = 0;
      const audio = new Audio();
      audio.src = sources[0];
      audio.loop = true;
      const volumeRatio = (musicVol / 100) * 0.72;
      audio.volume = Math.max(0, Math.min(1, volumeRatio));

      audio.addEventListener('playing', () => {
        this.stopSynthesizedMusic();
        this.isHtmlAudioPlaying = true;
      });

      audio.onerror = () => {
        this.tryNextSource();
      };

      this.audioElement = audio;
    }

    this.isHtmlAudioPlaying = true;
    const playPromise = this.audioElement.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.stopSynthesizedMusic();
          this.hasPendingAutoplay = false;
        })
        .catch((err) => {
          if (err.name === 'NotAllowedError') {
            this.hasPendingAutoplay = true;
          } else if (err.name !== 'AbortError') {
            this.tryNextSource();
          }
        });
    }
  }

  public nextTrack() {
    this.cycleTrack();
  }

  public stopMusic() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.isHtmlAudioPlaying = false;
    }
    this.hasPendingAutoplay = false;
    this.stopSynthesizedMusic();
  }

  private stopSynthesizedMusic() {
    if (this.musicTimer !== undefined) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = undefined;
    }
  }

  // Kerala temple ambient melody fallback
  private startSynthesizedMusic() {
    if (this.musicTimer !== undefined) return;
    const notes = [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 246.94, 293.66, 369.99, 440, 369.99, 196, 246.94, 293.66, 392];
    const playNext = () => {
      this.applySettings();
      const frequency = notes[this.musicStep % notes.length];
      this.musicStep += 1;
      this.tone(frequency, 0.42, 0.05, this.musicGain, 'sine');
      if (this.musicStep % 4 === 0) this.tone(frequency / 2, 0.75, 0.025, this.musicGain, 'triangle');
    };
    playNext();
    this.musicTimer = window.setInterval(playNext, 520);
  }

  /**
   * Main sound effect trigger. Uses instant Web Audio buffer playback,
   * with real-time procedural audio synthesis fallback.
   */
  public effect(effectName: PeerankiAudioEffect) {
    if (this.isMuted()) return;
    const sfxVol = getStoredSfxVolume();
    if (sfxVol === 0) return;

    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }

    if (this.hasPendingAutoplay && !this.isMuted()) {
      this.hasPendingAutoplay = false;
      this.startMusic();
    }

    // Normalize alias names
    const resolvedName = (effectName === 'peeranki' ? 'cannon' : effectName) as string;

    // 1. Try playing from preloaded decoded AudioBuffer (zero-latency sample playback)
    const cachedBuffer = this.audioBufferCache.get(resolvedName);
    if (cachedBuffer && this.effectsGain) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = cachedBuffer;
        source.connect(this.effectsGain);
        source.start();
        return;
      } catch {
        // Fall back to synthesizer if source failed
      }
    }

    // 2. Play using pristine real-time procedural Web Audio synthesizer
    this.playSynthesizedEffect(resolvedName);

    // Also trigger asynchronous buffer loading if not cached yet
    if (!this.audioBufferCache.has(resolvedName)) {
      void this.loadAudioBuffer(resolvedName);
    }
  }

  /**
   * Procedural synthesizer fallback for each effect: studio grade envelopes,
   * frequency sweeps, white noise filters, and multi-harmonic chords.
   */
  private playSynthesizedEffect(name: string) {
    const ctx = this.getContext();
    if (!ctx || !this.effectsGain) return;
    const dest = this.effectsGain;

    switch (name) {
      case 'click': {
        // Crisp tactile UI wooden tap
        this.tone(820, 0.045, 0.7, dest, 'triangle');
        this.noiseBurst(0.015, 0.35, dest, 1200);
        break;
      }

      case 'select': {
        // Bright dual-harmonic chime (D5 & A5)
        this.tone(587.33, 0.14, 0.5, dest, 'sine');
        window.setTimeout(() => this.tone(880.0, 0.16, 0.45, dest, 'sine'), 30);
        break;
      }

      case 'shoot': {
        // Pistol gunfire snap + rapid frequency sweep
        this.frequencySweep(480, 75, 0.16, 0.8, dest, 'sawtooth');
        this.noiseBurst(0.06, 0.65, dest, 2400);
        break;
      }

      case 'cannon': {
        // Peeranki heavy cannon blast: sub-bass rumble + punchy explosion
        this.frequencySweep(210, 36, 0.55, 0.95, dest, 'triangle');
        this.noiseBurst(0.45, 0.85, dest, 450);
        break;
      }

      case 'double_peeranki': {
        // Dual cannon volley
        this.frequencySweep(230, 40, 0.45, 0.85, dest, 'triangle');
        this.noiseBurst(0.35, 0.8, dest, 500);
        window.setTimeout(() => {
          this.frequencySweep(195, 34, 0.55, 0.95, dest, 'triangle');
          this.noiseBurst(0.45, 0.9, dest, 420);
        }, 120);
        break;
      }

      case 'hit': {
        // Solid body impact thud
        this.frequencySweep(240, 60, 0.16, 0.8, dest, 'sine');
        this.noiseBurst(0.04, 0.45, dest, 800);
        break;
      }

      case 'shield_hit': {
        // Resonant metallic forcefield ping
        this.tone(1480, 0.28, 0.6, dest, 'sine');
        this.tone(2240, 0.22, 0.45, dest, 'triangle');
        this.tone(880, 0.35, 0.5, dest, 'sine');
        this.noiseBurst(0.02, 0.3, dest, 3200);
        break;
      }

      case 'hook': {
        // Grappling hook whoosh through air
        this.frequencySweep(320, 950, 0.24, 0.55, dest, 'sine');
        this.noiseBurst(0.22, 0.4, dest, 1600);
        break;
      }

      case 'hook_strip': {
        // Metallic chain latch clank + shield rip
        [0, 35, 75, 120].forEach((delay) => {
          window.setTimeout(() => {
            this.tone(1850 - delay * 3, 0.08, 0.45, dest, 'triangle');
          }, delay);
        });
        this.noiseBurst(0.25, 0.6, dest, 1800);
        break;
      }

      case 'tower_damage': {
        // Stone fracture & cracking debris
        this.frequencySweep(180, 50, 0.25, 0.75, dest, 'sawtooth');
        this.noiseBurst(0.18, 0.55, dest, 950);
        break;
      }

      case 'tower_destroyed':
      case 'elimination': {
        // Heavy fortress collapse with tumbling stone rubble
        this.frequencySweep(140, 30, 0.65, 0.95, dest, 'triangle');
        this.noiseBurst(0.55, 0.9, dest, 380);
        [100, 240, 380].forEach((delay) => {
          window.setTimeout(() => this.noiseBurst(0.15, 0.4, dest, 550), delay);
        });
        break;
      }

      case 'count_tick': {
        // Crisp rhythmic woodblock / chenda tap
        this.tone(740, 0.045, 0.65, dest, 'sine');
        this.tone(1480, 0.025, 0.3, dest, 'triangle');
        break;
      }

      case 'shooter_selected': {
        // Triumphant brass fanfare accent
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
        notes.forEach((f, idx) => {
          window.setTimeout(() => {
            this.tone(f, 0.18, 0.6, dest, 'sawtooth');
          }, idx * 85);
        });
        break;
      }

      case 'timer_tick': {
        // Urgent warning pulse
        this.tone(960, 0.05, 0.6, dest, 'sine');
        break;
      }

      case 'duel_start': {
        // Dramatic showdown gong ring
        this.tone(220, 0.7, 0.6, dest, 'sine');
        this.tone(330, 0.5, 0.4, dest, 'triangle');
        this.tone(440, 0.4, 0.35, dest, 'sine');
        break;
      }

      case 'rps_clash': {
        // Blade & stone clash
        this.tone(1350, 0.22, 0.65, dest, 'triangle');
        this.tone(2700, 0.15, 0.45, dest, 'sine');
        this.noiseBurst(0.04, 0.4, dest, 2800);
        break;
      }

      case 'rps_tie': {
        // Neutral double ping
        this.tone(440, 0.16, 0.5, dest, 'sine');
        window.setTimeout(() => this.tone(440, 0.18, 0.5, dest, 'sine'), 120);
        break;
      }

      case 'rps_win': {
        // Victorious duel flourish
        const arpeggio = [587.33, 739.99, 880.0];
        arpeggio.forEach((f, idx) => {
          window.setTimeout(() => this.tone(f, 0.18, 0.55, dest, 'sine'), idx * 80);
        });
        break;
      }

      case 'weapon_upgrade': {
        // Shimmering magical harp arpeggio
        const harp = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51];
        harp.forEach((f, idx) => {
          window.setTimeout(() => this.tone(f, 0.22, 0.45, dest, 'sine'), idx * 75);
        });
        break;
      }

      case 'round_win': {
        // Triumphant brass round victory
        const fanfare = [440, 554.37, 659.25, 880];
        fanfare.forEach((f, idx) => {
          window.setTimeout(() => this.tone(f, 0.22, 0.6, dest, 'sawtooth'), idx * 110);
        });
        break;
      }

      case 'victory': {
        // Grand multi-chord victory celebration
        const chords = [
          { time: 0, freqs: [523.25, 659.25, 783.99] },
          { time: 250, freqs: [587.33, 739.99, 880.0] },
          { time: 500, freqs: [659.25, 830.61, 987.77] },
          { time: 800, freqs: [783.99, 987.77, 1046.5, 1318.51] },
        ];
        chords.forEach(({ time, freqs }) => {
          window.setTimeout(() => {
            freqs.forEach((f) => this.tone(f, 0.4, 0.45 / freqs.length, dest, 'sine'));
          }, time);
        });
        break;
      }

      case 'defeat': {
        // Sombre minor fall
        const defeatNotes = [440, 415.3, 392, 329.63];
        defeatNotes.forEach((f, idx) => {
          window.setTimeout(() => this.tone(f, 0.28, 0.5, dest, 'sine'), idx * 220);
        });
        break;
      }

      default: {
        this.tone(440, 0.1, 0.5, dest, 'sine');
      }
    }
  }

  private tone(
    frequency: number,
    duration: number,
    volume: number,
    destination?: GainNode,
    type: OscillatorType = 'sine',
  ) {
    const context = this.getContext();
    const dest = destination || this.effectsGain;
    if (!context || !dest || context.state !== 'running') return;
    try {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const start = context.currentTime;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(dest);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch {
      // ignore
    }
  }

  private frequencySweep(
    startFreq: number,
    endFreq: number,
    duration: number,
    volume: number,
    destination: GainNode,
    type: OscillatorType = 'sine',
  ) {
    const context = this.getContext();
    if (!context || context.state !== 'running') return;
    try {
      const osc = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(10, endFreq), start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch {
      // ignore
    }
  }

  private noiseBurst(
    duration: number,
    volume: number,
    destination: GainNode,
    filterFreq = 1000,
  ) {
    const context = this.getContext();
    if (!context || context.state !== 'running') return;
    try {
      const bufferSize = Math.floor(context.sampleRate * duration);
      const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = context.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq, context.currentTime);

      const gain = context.createGain();
      const start = context.currentTime;
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      whiteNoise.start(start);
      whiteNoise.stop(start + duration + 0.02);
    } catch {
      // ignore
    }
  }
}

export const PeerankiAudio = new PeerankiAudioSystem();
