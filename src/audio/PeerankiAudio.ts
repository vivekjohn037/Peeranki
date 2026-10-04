// Peeranki Audio System
// Supports background music playback from public/assets/audio/ (bg_music.mp3, bg_music_1.mp3, bg_music_2.mp3)
// and SFX from public/assets/audio/ (click.mp3, select.mp3, shoot.mp3, hit.mp3, elimination.mp3, victory.mp3).
// Handles autoplay unlock on user interaction and provides track switching.

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
      'assets/audio/bg_music.mp3',
      'assets/audio/bg_music_1.mp3',
      '/assets/audio/bg_music.mp3',
      '/assets/audio/bg_music_1.mp3',
      'assets/audio/bg_music.wav',
      '/assets/audio/bg_music.wav',
    ],
  },
  {
    id: 2,
    title: 'Kerala Folk Battle Theme',
    filename: 'bg_music_2.mp3',
    sources: [
      'assets/audio/bg_music_2.mp3',
      '/assets/audio/bg_music_2.mp3',
      'assets/audio/bg_music.mp3',
      '/assets/audio/bg_music.mp3',
    ],
  },
];

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

  // SFX cache for instant response
  private sfxPool: Map<string, HTMLAudioElement[]> = new Map();

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
    const sfxList: Array<{ name: string; src: string; fallback: string }> = [
      { name: 'click', src: 'assets/audio/click.mp3', fallback: 'assets/audio/click.wav' },
      { name: 'select', src: 'assets/audio/select.mp3', fallback: 'assets/audio/select.wav' },
      { name: 'shoot', src: 'assets/audio/shoot.mp3', fallback: 'assets/audio/shoot.wav' },
      { name: 'hit', src: 'assets/audio/hit.mp3', fallback: 'assets/audio/hit.wav' },
      { name: 'elimination', src: 'assets/audio/elimination.mp3', fallback: 'assets/audio/elimination.wav' },
      { name: 'victory', src: 'assets/audio/victory.mp3', fallback: 'assets/audio/victory.wav' },
    ];

    sfxList.forEach(({ name, src, fallback }) => {
      const audio1 = new Audio(src);
      audio1.preload = 'auto';
      audio1.onerror = () => {
        audio1.src = fallback;
      };
      const audio2 = new Audio(src);
      audio2.preload = 'auto';
      audio2.onerror = () => {
        audio2.src = fallback;
      };
      this.sfxPool.set(name, [audio1, audio2]);
    });
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
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    const sfxVol = getStoredSfxVolume();

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
      this.effectsGain?.gain.setTargetAtTime((sfxVol / 100) * 0.24, now, 0.04);
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
            // Autoplay was blocked before user interaction; wait for gesture instead of synthesized beeps
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

  // Graceful synthesized Kerala temple ambient melody fallback (used only if all audio files fail)
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

  public effect(name: 'click' | 'select' | 'shoot' | 'hit' | 'elimination' | 'victory') {
    const sfxVol = getStoredSfxVolume();
    if (sfxVol === 0) return;

    if (this.context && this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }

    // Trigger music start if autoplay was pending on this user interaction
    if (this.hasPendingAutoplay && !this.isMuted()) {
      this.hasPendingAutoplay = false;
      this.startMusic();
    }

    // Try pool of preloaded audio elements
    const pool = this.sfxPool.get(name);
    let played = false;
    if (pool && pool.length > 0) {
      // Find an audio element that is either paused or ended
      let sfx = pool.find((a) => a.paused || a.ended);
      if (!sfx) {
        sfx = pool[0];
        sfx.currentTime = 0;
      }
      sfx.volume = Math.max(0, Math.min(1, (sfxVol / 100) * 0.85));
      const p = sfx.play();
      if (p !== undefined) {
        p.catch(() => {
          this.playSynthesizedEffect(name);
        });
      }
      played = true;
    }

    if (!played) {
      // Direct audio load
      const sfx = new Audio(`assets/audio/${name}.mp3`);
      sfx.volume = Math.max(0, Math.min(1, (sfxVol / 100) * 0.85));
      const sfxPromise = sfx.play();
      if (sfxPromise !== undefined) {
        sfxPromise.catch(() => {
          this.playSynthesizedEffect(name);
        });
      } else {
        this.playSynthesizedEffect(name);
      }
    }
  }

  private playSynthesizedEffect(name: 'click' | 'select' | 'shoot' | 'hit' | 'elimination' | 'victory') {
    const patterns: Record<typeof name, number[]> = {
      click: [620],
      select: [440, 660],
      shoot: [180, 110],
      hit: [520, 390],
      elimination: [330, 220, 110],
      victory: [523.25, 659.25, 783.99, 1046.5],
    };
    const durations: Record<typeof name, number> = {
      click: 0.07,
      select: 0.11,
      shoot: 0.13,
      hit: 0.14,
      elimination: 0.2,
      victory: 0.28,
    };
    patterns[name].forEach((frequency, index) => {
      window.setTimeout(
        () => this.tone(frequency, durations[name], 0.65, this.effectsGain, name === 'shoot' ? 'sawtooth' : 'sine'),
        index * (name === 'victory' ? 120 : 75),
      );
    });
  }

  private tone(frequency: number, duration: number, volume: number, destination?: GainNode, type: OscillatorType = 'sine') {
    const context = this.getContext();
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

export const PeerankiAudio = new PeerankiAudioSystem();
