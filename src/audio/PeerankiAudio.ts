// Peeranki Permanent Soundtrack & Audio System
// Plays the authentic permanent Peeranki theme soundtrack with seamless looping,
// volume controls, mute toggling, and synthesized fallback.

const SETTINGS_KEY = 'peeranki-settings';
const MUTE_KEY = 'peeranki_music_muted';

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

export type MusicMode = 'both' | 'track1' | 'track2';

export class PeerankiAudioSystem {
  private context?: AudioContext;
  private musicGain?: GainNode;
  private effectsGain?: GainNode;
  private musicTimer?: number;
  private musicStep = 0;

  private audioElement: HTMLAudioElement | null = null;
  private permanentSongUrl = 'assets/audio/bg_music.mp3';
  private permanentSongFallbackUrl = 'assets/audio/bg_music.wav';
  private isHtmlAudioPlaying = false;
  private onTrackChangeCallbacks = new Set<() => void>();

  constructor() {
    // Pre-warm audio if running in browser
    if (typeof window !== 'undefined') {
      // Remove any legacy uploaded song overrides from previous sessions
      try {
        localStorage.removeItem('peeranki_music_mode');
      } catch {
        // ignore
      }
    }
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

  public getPermanentSongName(): string {
    return 'Peeranki Festival Valley Theme';
  }

  // Backward compatibility stubs
  public getMusicMode(): MusicMode {
    return 'track1';
  }

  public setMusicMode(_mode: MusicMode) {
    this.notifyChange();
  }

  public cycleMusicMode(): MusicMode {
    return 'track1';
  }

  public getCurrentTrack(): 1 | 2 {
    return 1;
  }

  public isTrackLoaded(_slot: 1 | 2): boolean {
    return true;
  }

  public hasCustomUpload(_slot: 1 | 2): boolean {
    return false;
  }

  public async setCustomTrack(_slot: 1 | 2, _file: File | Blob) {
    // Permanent song is locked
    return Promise.resolve();
  }

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

    // 2. Update Web Audio synthesizer volume
    const now = this.context?.currentTime ?? 0;
    this.musicGain?.gain.setTargetAtTime((musicVol / 100) * 0.16, now, 0.04);
    this.effectsGain?.gain.setTargetAtTime((sfxVol / 100) * 0.24, now, 0.04);
  }

  public startMusic() {
    if (this.isMuted()) return;
    const musicVol = getStoredMusicVolume();
    if (musicVol === 0) return;

    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }

    if (!this.audioElement) {
      const audio = new Audio();
      audio.src = this.permanentSongUrl;
      audio.loop = true;
      const volumeRatio = (musicVol / 100) * 0.72;
      audio.volume = Math.max(0, Math.min(1, volumeRatio));

      // Try fallback to wav if mp3 cannot load
      audio.onerror = () => {
        if (audio.src.endsWith('.mp3')) {
          console.info('[PeerankiAudio] Retrying with WAV permanent track...');
          audio.src = this.permanentSongFallbackUrl;
          void audio.play().catch(() => {
            this.startSynthesizedMusic();
          });
        } else {
          console.info('[PeerankiAudio] Falling back to Web Audio ambient synthesizer.');
          this.audioElement = null;
          this.isHtmlAudioPlaying = false;
          this.startSynthesizedMusic();
        }
      };

      this.audioElement = audio;
    }

    this.isHtmlAudioPlaying = true;
    const playPromise = this.audioElement.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        if (err.name !== 'AbortError') {
          // Fall back to synth on autoplay restrictions or format issue
          this.startSynthesizedMusic();
        }
      });
    }
  }

  public nextTrack() {
    // There is one permanent theme, restart or maintain
    if (this.audioElement) {
      this.audioElement.currentTime = 0;
      void this.audioElement.play().catch(() => undefined);
    }
  }

  public stopMusic() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.isHtmlAudioPlaying = false;
    }
    this.stopSynthesizedMusic();
  }

  private stopSynthesizedMusic() {
    if (this.musicTimer !== undefined) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = undefined;
    }
  }

  // Graceful synthesized Kerala temple ambient melody fallback
  private startSynthesizedMusic() {
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

  public effect(name: 'click' | 'select' | 'shoot' | 'hit' | 'elimination' | 'victory') {
    const sfxVol = getStoredSfxVolume();
    if (sfxVol === 0) return;

    const context = this.getContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    this.startMusic();
    this.applySettings();

    // Check for custom audio effect file first
    const audioPath = `assets/audio/${name}.mp3`;
    const sfx = new Audio(audioPath);
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

export const PeerankiAudio = new PeerankiAudioSystem();
