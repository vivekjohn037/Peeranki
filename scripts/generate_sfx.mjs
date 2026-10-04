// SFX Generator for Peeranki Game
// Generates studio-quality 44.1kHz 16-bit PCM WAV audio files for all sound effects

import fs from 'fs';
import path from 'path';

const SAMPLE_RATE = 44100;

function createWavBuffer(samples, sampleRate = SAMPLE_RATE) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write PCM 16-bit signed integer samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.floor(val), offset);
    offset += 2;
  }

  return buffer;
}

// Utility synthesis functions
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// 1. CLICK: Crisp wooden UI tap with quick transient click and warm body
function synthClick() {
  const duration = 0.06;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 90);
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 300);
    const body = Math.sin(2 * Math.PI * (820 - t * 4000) * t);
    samples[i] = (noise * 0.4 + body * 0.6) * env * 0.8;
  }
  return samples;
}

// 2. SELECT: Bright pleasant dual-harmonic marimba chime
function synthSelect() {
  const duration = 0.16;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 22);
    const f1 = 587.33; // D5
    const f2 = 880.0; // A5
    const f3 = 1174.66; // D6
    const s = Math.sin(2 * Math.PI * f1 * t) * 0.5 +
              Math.sin(2 * Math.PI * f2 * t) * 0.35 +
              Math.sin(2 * Math.PI * f3 * t) * 0.15;
    samples[i] = s * env * 0.75;
  }
  return samples;
}

// 3. SHOOT: Sharp pistol gunshot with crisp supersonic snap and punchy drop
function synthShoot() {
  const duration = 0.22;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  let noiseFilter = 0;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const snapEnv = Math.exp(-t * 120);
    const bodyEnv = Math.exp(-t * 28);
    // Frequency drop from 450Hz down to 80Hz
    const freq = 450 * Math.exp(-t * 40) + 80;
    const body = Math.sin(2 * Math.PI * freq * t);
    const rawNoise = Math.random() * 2 - 1;
    noiseFilter += (rawNoise - noiseFilter) * 0.45;
    samples[i] = (snapEnv * noiseFilter * 0.7 + body * bodyEnv * 0.6) * 0.9;
  }
  return samples;
}

// 4. CANNON / PEERANKI: Massive heavy cannon blast with sub-bass punch and rolling explosion rumble
function synthCannon() {
  const duration = 0.65;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  let rumbleFilter = 0;
  let lp = 0;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const snapEnv = Math.exp(-t * 70);
    const punchEnv = Math.exp(-t * 12);
    const rumbleEnv = Math.exp(-t * 6);
    // Sub bass drop from 180Hz down to 38Hz
    const freq = 180 * Math.exp(-t * 20) + 38;
    const sub = Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(Math.PI * freq * t);
    const rawNoise = Math.random() * 2 - 1;
    // Lowpass filter for explosion rumble
    lp += (rawNoise - lp) * 0.08;
    rumbleFilter += (lp - rumbleFilter) * 0.12;
    const s = (rawNoise * snapEnv * 0.6 + sub * punchEnv * 0.8 + rumbleFilter * rumbleEnv * 1.2);
    // Soft distortion saturation
    samples[i] = Math.tanh(s * 1.4) * 0.95;
  }
  return samples;
}

// 5. DOUBLE PEERANKI: Rapid dual-barrel cannon blast
function synthDoublePeeranki() {
  const single = synthCannon();
  const delay = Math.floor(0.12 * SAMPLE_RATE);
  const totalCount = single.length + delay;
  const samples = new Float32Array(totalCount);
  for (let i = 0; i < single.length; i++) {
    samples[i] += single[i] * 0.75;
  }
  for (let i = 0; i < single.length; i++) {
    samples[i + delay] += single[i] * 0.85;
  }
  for (let i = 0; i < totalCount; i++) {
    samples[i] = Math.tanh(samples[i] * 1.1) * 0.95;
  }
  return samples;
}

// 6. HIT: Physical solid impact thud on stone/wood
function synthHit() {
  const duration = 0.18;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 35);
    const freq = 220 * Math.exp(-t * 25) + 65;
    const body = Math.sin(2 * Math.PI * freq * t);
    const slap = (Math.random() * 2 - 1) * Math.exp(-t * 110);
    samples[i] = (body * 0.7 + slap * 0.4) * env * 0.85;
  }
  return samples;
}

// 7. SHIELD HIT: High-tech metallic energy deflection "TINGGG-twang" with harmonic shimmer
function synthShieldHit() {
  const duration = 0.38;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 14);
    // Metallic inharmonic frequencies
    const m1 = Math.sin(2 * Math.PI * 1480 * t);
    const m2 = Math.sin(2 * Math.PI * 2240 * t);
    const m3 = Math.sin(2 * Math.PI * 3380 * t);
    const m4 = Math.sin(2 * Math.PI * 880 * t);
    // Forcefield frequency modulation
    const fm = Math.sin(2 * Math.PI * 45 * t) * 0.2;
    const metallic = (m1 * 0.4 + m2 * 0.3 + m3 * 0.2 + m4 * 0.35) * (1 + fm);
    const spark = (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.3;
    samples[i] = (metallic * 0.75 + spark) * env * 0.85;
  }
  return samples;
}

// 8. HOOK: Fast whoosh of grappling hook through the air
function synthHook() {
  const duration = 0.28;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  let filter = 0;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.sin(Math.PI * (t / duration));
    const noise = Math.random() * 2 - 1;
    // Swept bandpass whoosh
    const cutoff = 0.05 + 0.35 * Math.sin(Math.PI * (t / duration));
    filter += (noise - filter) * cutoff;
    const whistle = Math.sin(2 * Math.PI * (600 + 400 * (t / duration)) * t) * 0.2;
    samples[i] = (filter * 0.7 + whistle) * env * 0.8;
  }
  return samples;
}

// 9. HOOK STRIP: Metal chain latch clank followed by ripping shatter
function synthHookStrip() {
  const duration = 0.45;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const clankEnv = Math.exp(-t * 40);
    const ripEnv = Math.exp(-t * 12);
    // Chain clatter (series of fast metallic impulses)
    let chain = 0;
    [0.0, 0.03, 0.07, 0.12].forEach((offset) => {
      if (t >= offset) {
        const dt = t - offset;
        chain += Math.sin(2 * Math.PI * 1850 * dt) * Math.exp(-dt * 60) * 0.35;
      }
    });
    // Rip/shatter noise
    const rip = (Math.random() * 2 - 1) * ripEnv * 0.5;
    samples[i] = (chain + rip + Math.sin(2 * Math.PI * 340 * t) * clankEnv * 0.4) * 0.9;
  }
  return samples;
}

// 10. TOWER DAMAGE: Stone cracking with splintering debris
function synthTowerDamage() {
  const duration = 0.32;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  let lp = 0;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const crackEnv = Math.exp(-t * 45);
    const debrisEnv = Math.exp(-t * 16);
    const rawNoise = Math.random() * 2 - 1;
    lp += (rawNoise - lp) * 0.15;
    const impact = Math.sin(2 * Math.PI * (160 - t * 250) * t) * crackEnv * 0.6;
    const crack = rawNoise * crackEnv * 0.6;
    const debris = lp * debrisEnv * 0.4;
    samples[i] = (impact + crack + debris) * 0.85;
  }
  return samples;
}

// 11. TOWER DESTROYED / ELIMINATION: Catastrophic fortress collapse with rolling stone crash
function synthTowerDestroyed() {
  const duration = 0.85;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  let lp = 0;
  let rumble = 0;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const hitEnv = Math.exp(-t * 20);
    const fallEnv = Math.exp(-t * 5.5);
    const noise = Math.random() * 2 - 1;
    lp += (noise - lp) * 0.12;
    rumble += (lp - rumble) * 0.08;
    const sub = Math.sin(2 * Math.PI * (95 - t * 60) * t) * hitEnv * 0.7;
    // Series of crashing stone impacts
    let rocks = 0;
    [0.1, 0.22, 0.36, 0.48].forEach((offset, idx) => {
      if (t >= offset) {
        const dt = t - offset;
        rocks += (Math.random() * 2 - 1) * Math.exp(-dt * 25) * (0.35 / (idx + 1));
      }
    });
    const s = sub + rumble * fallEnv * 0.9 + rocks;
    samples[i] = Math.tanh(s * 1.3) * 0.9;
  }
  return samples;
}

// 12. COUNT TICK: Crisp woodblock/chenda drum tap for 1-20 counting
function synthCountTick() {
  const duration = 0.09;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 55);
    const wood = Math.sin(2 * Math.PI * 740 * t) * 0.7 + Math.sin(2 * Math.PI * 1480 * t) * 0.3;
    const click = (Math.random() * 2 - 1) * Math.exp(-t * 220) * 0.35;
    samples[i] = (wood * 0.75 + click) * env * 0.75;
  }
  return samples;
}

// 13. SHOOTER SELECTED: Triumphant brass accent arpeggio marking the chosen shooter
function synthShooterSelected() {
  const duration = 0.45;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  const notes = [
    { f: 523.25, start: 0.0, dur: 0.14 }, // C5
    { f: 659.25, start: 0.09, dur: 0.14 }, // E5
    { f: 783.99, start: 0.18, dur: 0.26 }, // G5
  ];
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    notes.forEach(({ f, start, dur }) => {
      if (t >= start && t <= start + dur) {
        const dt = t - start;
        const env = Math.sin(Math.PI * (dt / dur)) * Math.exp(-dt * 4);
        const osc = Math.sin(2 * Math.PI * f * dt) + 0.3 * Math.sin(4 * Math.PI * f * dt);
        s += osc * env * 0.45;
      }
    });
    samples[i] = clamp(s, -1, 1) * 0.85;
  }
  return samples;
}

// 14. TIMER TICK: Sharp warning pulse for countdown timer
function synthTimerTick() {
  const duration = 0.07;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 70);
    const f = 920;
    samples[i] = Math.sin(2 * Math.PI * f * t) * env * 0.7;
  }
  return samples;
}

// 15. DUEL START: Dramatic gong ring signaling 1v1 showdown
function synthDuelStart() {
  const duration = 0.75;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 5);
    const g1 = Math.sin(2 * Math.PI * 220 * t);
    const g2 = Math.sin(2 * Math.PI * 330 * t) * 0.6;
    const g3 = Math.sin(2 * Math.PI * 440 * t) * 0.4;
    const strike = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.4;
    samples[i] = (g1 + g2 + g3 + strike) * env * 0.5;
  }
  return samples;
}

// 16. RPS CLASH: Sharp metal blade / stone clash
function synthRpsClash() {
  const duration = 0.28;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 22);
    const m1 = Math.sin(2 * Math.PI * 1350 * t);
    const m2 = Math.sin(2 * Math.PI * 2700 * t) * 0.5;
    const spark = (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.5;
    samples[i] = (m1 + m2 + spark) * env * 0.75;
  }
  return samples;
}

// 17. RPS TIE: Neutral double chime
function synthRpsTie() {
  const duration = 0.35;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    [0.0, 0.12].forEach((offset) => {
      if (t >= offset) {
        const dt = t - offset;
        const env = Math.exp(-dt * 20);
        s += Math.sin(2 * Math.PI * 440 * dt) * env * 0.4;
      }
    });
    samples[i] = s * 0.8;
  }
  return samples;
}

// 18. RPS WIN: Victorious duel chime
function synthRpsWin() {
  const duration = 0.45;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  const notes = [
    { f: 587.33, start: 0.0, dur: 0.14 }, // D5
    { f: 739.99, start: 0.08, dur: 0.14 }, // F#5
    { f: 880.0, start: 0.16, dur: 0.28 }, // A5
  ];
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    notes.forEach(({ f, start, dur }) => {
      if (t >= start && t <= start + dur) {
        const dt = t - start;
        const env = Math.exp(-dt * 12);
        s += Math.sin(2 * Math.PI * f * dt) * env * 0.35;
      }
    });
    samples[i] = s * 0.9;
  }
  return samples;
}

// 19. WEAPON UPGRADE: Sparkling level-up harp flourish
function synthWeaponUpgrade() {
  const duration = 0.75;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  const arpeggio = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51];
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    arpeggio.forEach((f, idx) => {
      const start = idx * 0.08;
      if (t >= start) {
        const dt = t - start;
        const env = Math.exp(-dt * 10);
        const shimmer = Math.sin(2 * Math.PI * f * dt) + 0.25 * Math.sin(4 * Math.PI * f * dt);
        s += shimmer * env * 0.25;
      }
    });
    samples[i] = clamp(s, -1, 1) * 0.85;
  }
  return samples;
}

// 20. ROUND WIN: Triumphant fanfare
function synthRoundWin() {
  const duration = 0.7;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  const notes = [
    { f: 440, start: 0.0, dur: 0.16 }, // A4
    { f: 554.37, start: 0.12, dur: 0.16 }, // C#5
    { f: 659.25, start: 0.24, dur: 0.18 }, // E5
    { f: 880, start: 0.38, dur: 0.32 }, // A5
  ];
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    notes.forEach(({ f, start, dur }) => {
      if (t >= start && t <= start + dur) {
        const dt = t - start;
        const env = Math.exp(-dt * 8);
        const osc = Math.sin(2 * Math.PI * f * dt) + 0.35 * Math.sin(3 * Math.PI * f * dt);
        s += osc * env * 0.35;
      }
    });
    samples[i] = clamp(s, -1, 1) * 0.85;
  }
  return samples;
}

// 21. VICTORY: Grand celebration fanfare with rich chords and sparkle
function synthVictory() {
  const duration = 1.6;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  const chords = [
    { start: 0.0, dur: 0.28, freqs: [523.25, 659.25, 783.99] }, // C major
    { start: 0.26, dur: 0.28, freqs: [587.33, 739.99, 880.0] }, // D major
    { start: 0.52, dur: 0.34, freqs: [659.25, 830.61, 987.77] }, // E major
    { start: 0.82, dur: 0.75, freqs: [783.99, 987.77, 1046.5, 1318.51] }, // C major peak
  ];
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    chords.forEach(({ start, dur, freqs }) => {
      if (t >= start && t <= start + dur) {
        const dt = t - start;
        const env = Math.sin(Math.PI * Math.min(1, dt / 0.06)) * Math.exp(-dt * 4);
        freqs.forEach((f) => {
          s += (Math.sin(2 * Math.PI * f * dt) + 0.25 * Math.sin(2 * Math.PI * f * 2 * dt)) * (0.22 / freqs.length);
        });
        s *= env;
      }
    });
    samples[i] = clamp(s, -1, 1) * 0.9;
  }
  return samples;
}

// 22. DEFEAT: Sombre descending minor fall
function synthDefeat() {
  const duration = 0.95;
  const count = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(count);
  const notes = [
    { f: 440, start: 0.0, dur: 0.28 }, // A4
    { f: 415.3, start: 0.24, dur: 0.28 }, // Ab4
    { f: 392, start: 0.48, dur: 0.28 }, // G4
    { f: 329.63, start: 0.70, dur: 0.25 }, // E4
  ];
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    notes.forEach(({ f, start, dur }) => {
      if (t >= start && t <= start + dur) {
        const dt = t - start;
        const env = Math.exp(-dt * 6);
        s += Math.sin(2 * Math.PI * f * dt) * env * 0.35;
      }
    });
    samples[i] = s * 0.85;
  }
  return samples;
}

// Map of all generators
const SOUND_GENERATORS = {
  click: synthClick,
  select: synthSelect,
  shoot: synthShoot,
  cannon: synthCannon,
  double_peeranki: synthDoublePeeranki,
  hit: synthHit,
  shield_hit: synthShieldHit,
  hook: synthHook,
  hook_strip: synthHookStrip,
  tower_damage: synthTowerDamage,
  tower_destroyed: synthTowerDestroyed,
  elimination: synthTowerDestroyed,
  count_tick: synthCountTick,
  shooter_selected: synthShooterSelected,
  timer_tick: synthTimerTick,
  duel_start: synthDuelStart,
  rps_clash: synthRpsClash,
  rps_tie: synthRpsTie,
  rps_win: synthRpsWin,
  weapon_upgrade: synthWeaponUpgrade,
  round_win: synthRoundWin,
  victory: synthVictory,
  defeat: synthDefeat,
};

const outDir = path.resolve('public/assets/audio');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log('Generating studio SFX WAV files...');
for (const [name, generator] of Object.entries(SOUND_GENERATORS)) {
  const samples = generator();
  const wavBuffer = createWavBuffer(samples);
  const outPath = path.join(outDir, `${name}.wav`);
  fs.writeFileSync(outPath, wavBuffer);
  // Also create .mp3 copy (standard browsers will play WAV in MP3 container if fallback, or we can provide both)
  const mp3Path = path.join(outDir, `${name}.mp3`);
  // For files that didn't exist before, write as fallback
  if (!fs.existsSync(mp3Path) || ['cannon', 'double_peeranki', 'shield_hit', 'hook', 'hook_strip', 'tower_damage', 'tower_destroyed', 'count_tick', 'shooter_selected', 'timer_tick', 'duel_start', 'rps_clash', 'rps_tie', 'rps_win', 'weapon_upgrade', 'round_win', 'defeat'].includes(name)) {
    fs.writeFileSync(mp3Path, wavBuffer);
  }
  console.log(`✓ ${name}.wav (${(wavBuffer.length / 1024).toFixed(1)} KB)`);
}
console.log('Done generating all SFX!');
