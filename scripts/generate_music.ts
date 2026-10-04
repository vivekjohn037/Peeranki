import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const sampleRate = 44100;
const bpm = 120;
const beatsPerBar = 4;
const totalBars = 16;
const totalBeats = totalBars * beatsPerBar;
const beatDuration = 60 / bpm; // 0.5s
const totalDuration = totalBeats * beatDuration; // 32.0s
const totalSamples = Math.floor(sampleRate * totalDuration);

// Two channels: left and right
const leftChannel = new Float32Array(totalSamples);
const rightChannel = new Float32Array(totalSamples);

function addSample(i: number, l: number, r: number) {
  const wrapped = ((i % totalSamples) + totalSamples) % totalSamples;
  leftChannel[wrapped] += l;
  rightChannel[wrapped] += r;
}

// 1. Tanpura / Drone in D
const dRoot = 146.83; // D3
const aFifth = 220.00; // A3
const dOctave = 293.66; // D4

for (let i = 0; i < totalSamples; i++) {
  const t = i / sampleRate;
  const lfo = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t);
  const drone1 = (Math.sin(2 * Math.PI * dRoot * t) + 0.3 * Math.sin(2 * Math.PI * dRoot * 2 * t)) * 0.12;
  const drone2 = (Math.sin(2 * Math.PI * aFifth * t) + 0.2 * Math.sin(2 * Math.PI * aFifth * 2 * t)) * 0.08;
  const drone3 = Math.sin(2 * Math.PI * (dRoot / 2) * t) * 0.14; // Sub-bass D2 (73.4Hz)
  const totalDrone = (drone1 + drone2 + drone3) * lfo;
  leftChannel[i] += totalDrone * 0.85;
  rightChannel[i] += totalDrone * 0.85;
}

// 2. Kerala Chenda Drum & Percussion Rhythm
// 16 bars, each 4 beats
for (let bar = 0; bar < totalBars; bar++) {
  for (let beat = 0; beat < 4; beat++) {
    const beatTime = (bar * 4 + beat) * beatDuration;
    const startSample = Math.floor(beatTime * sampleRate);

    // Bass drum (Uruttu Chenda bass hit on beat 0 and beat 2)
    if (beat === 0 || beat === 2) {
      const drumLen = Math.floor(sampleRate * 0.35);
      for (let s = 0; s < drumLen; s++) {
        const dt = s / sampleRate;
        const freq = 110 * Math.exp(-dt * 14) + 48;
        const env = Math.exp(-dt * 9);
        const val = Math.sin(2 * Math.PI * freq * dt) * env * 0.35;
        addSample(startSample + s, val * 0.9, val * 0.9);
      }
    }

    // Snare / Chenda stick crack on beat 1 and beat 3 (and syncopated beat 2.5)
    if (beat === 1 || beat === 3) {
      const crackLen = Math.floor(sampleRate * 0.16);
      for (let s = 0; s < crackLen; s++) {
        const dt = s / sampleRate;
        const env = Math.exp(-dt * 26);
        const noise = (Math.random() * 2 - 1) * 0.22;
        const tone = Math.sin(2 * Math.PI * 340 * dt) * 0.25;
        const val = (noise + tone) * env * 0.32;
        addSample(startSample + s, val * 0.75, val * 0.95);
      }
    }

    // Syncopated secondary tap on the "and" of beat 2
    if (beat === 2) {
      const tapStart = startSample + Math.floor(sampleRate * (beatDuration * 0.5));
      const tapLen = Math.floor(sampleRate * 0.12);
      for (let s = 0; s < tapLen; s++) {
        const dt = s / sampleRate;
        const env = Math.exp(-dt * 30);
        const val = Math.sin(2 * Math.PI * 460 * dt) * env * 0.18;
        addSample(tapStart + s, val * 0.9, val * 0.65);
      }
    }

    // Shakers & Temple Bell pulses on eighth notes
    for (let sub = 0; sub < 2; sub++) {
      const subStart = startSample + Math.floor(sampleRate * (sub * beatDuration * 0.5));
      const shakerLen = Math.floor(sampleRate * 0.06);
      for (let s = 0; s < shakerLen; s++) {
        const dt = s / sampleRate;
        const env = Math.exp(-dt * 45);
        const noise = (Math.random() * 2 - 1) * 0.05 * env;
        addSample(subStart + s, noise * 0.8, noise * 0.5);
      }

      // Bell accent on bars
      if (sub === 0 && (beat === 0 || beat === 3)) {
        const bellLen = Math.floor(sampleRate * 0.6);
        for (let s = 0; s < bellLen; s++) {
          const dt = s / sampleRate;
          const env = Math.exp(-dt * 6);
          const bell = (
            Math.sin(2 * Math.PI * 1174.66 * dt) * 0.5 + // D6
            Math.sin(2 * Math.PI * 1760.00 * dt) * 0.3 + // A6
            Math.sin(2 * Math.PI * 2349.32 * dt) * 0.2   // D7
          ) * env * 0.08;
          addSample(subStart + s, bell * 0.4, bell * 0.9);
        }
      }
    }
  }
}

// 3. Kerala Melodic Theme (Mohanam Raga: D, E, F#, A, B, D5)
// Frequencies
const notes: Record<string, number> = {
  D4: 293.66,
  E4: 329.63,
  Fs4: 369.99,
  A4: 440.00,
  B4: 493.88,
  D5: 587.33,
  E5: 659.25,
  Fs5: 739.99,
  A5: 880.00,
};

// Melody notation: [note, startBeat, durationBeats]
const melody: Array<[string, number, number]> = [
  // Phrase 1 (Bars 0-3): Welcoming festive rise
  ['D4', 0, 1], ['Fs4', 1, 1], ['A4', 2, 1], ['B4', 3, 1],
  ['A4', 4, 1.5], ['Fs4', 5.5, 0.5], ['D4', 6, 2],
  ['E4', 8, 1], ['Fs4', 9, 1], ['A4', 10, 1.5], ['B4', 11.5, 0.5],
  ['D5', 12, 2.5], ['B4', 14.5, 0.5], ['A4', 15, 1],

  // Phrase 2 (Bars 4-7): Soaring mountain village valley theme
  ['D5', 16, 1], ['E5', 17, 1], ['Fs5', 18, 1.5], ['E5', 19.5, 0.5],
  ['D5', 20, 1], ['B4', 21, 1], ['A4', 22, 2],
  ['B4', 24, 1], ['D5', 25, 1], ['E5', 26, 1.5], ['Fs5', 27.5, 0.5],
  ['E5', 28, 2], ['D5', 30, 2],

  // Phrase 3 (Bars 8-11): Playful cannon festival rhythm
  ['A4', 32, 0.75], ['B4', 32.75, 0.75], ['D5', 33.5, 1.5],
  ['B4', 35, 1], ['A4', 36, 1.5], ['Fs4', 37.5, 0.5],
  ['E4', 38, 1], ['D4', 39, 1], ['E4', 40, 2],
  ['Fs4', 42, 1], ['A4', 43, 1], ['B4', 44, 2],
  ['D5', 46, 2],

  // Phrase 4 (Bars 12-15): Resolving cadence that loops smoothly into phrase 1
  ['E5', 48, 1], ['Fs5', 49, 1], ['A5', 50, 1.5], ['Fs5', 51.5, 0.5],
  ['E5', 52, 1], ['D5', 53, 1], ['B4', 54, 2],
  ['A4', 56, 1], ['B4', 57, 1], ['D5', 58, 1.5], ['E5', 59.5, 0.5],
  ['D5', 60, 2.5], ['A4', 62.5, 1.5],
];

// Synthesize flute/chime lead melody
for (const [noteName, startBeat, durBeats] of melody) {
  const freq = notes[noteName] ?? 440;
  const startSec = startBeat * beatDuration;
  const durSec = durBeats * beatDuration;
  const startSample = Math.floor(startSec * sampleRate);
  const noteSamples = Math.floor((durSec + 0.35) * sampleRate); // Include reverb ring

  for (let s = 0; s < noteSamples; s++) {
    const dt = s / sampleRate;
    // Envelope
    let env = 1.0;
    const attack = 0.04;
    const release = 0.18;
    if (dt < attack) {
      env = dt / attack;
    } else if (dt > durSec) {
      env = Math.max(0, 1 - (dt - durSec) / release);
    }
    // Vibrato (slight pitch modulation for expressive bamboo flute feel)
    const vibrato = 1.0 + 0.006 * Math.sin(2 * Math.PI * 5.2 * dt);
    const curFreq = freq * vibrato;

    // Harmonic blend: pure sine + warm 2nd harmonic + delicate 3rd harmonic
    const sig = (
      Math.sin(2 * Math.PI * curFreq * dt) * 0.7 +
      Math.sin(2 * Math.PI * curFreq * 2 * dt) * 0.22 +
      Math.sin(2 * Math.PI * curFreq * 3 * dt) * 0.08
    ) * env * 0.26;

    // Add stereo delay for warm ambient acoustic presence
    const leftSig = sig * 0.85;
    const rightSig = sig * 0.7;
    addSample(startSample + s, leftSig, rightSig);

    // Warm ping-pong echo (375ms delay)
    const echoDelay = Math.floor(sampleRate * 0.375);
    addSample(startSample + s + echoDelay, rightSig * 0.35, leftSig * 0.35);
  }
}

// 4. Mallet / Marimba arpeggio accents in the background
const arpeggioNotes = [notes.D4, notes.Fs4, notes.A4, notes.D5, notes.A4, notes.Fs4];
for (let b = 0; b < totalBeats; b++) {
  const arpFreq = arpeggioNotes[b % arpeggioNotes.length];
  const arpStart = Math.floor(b * beatDuration * sampleRate);
  const arpLen = Math.floor(sampleRate * 0.28);
  for (let s = 0; s < arpLen; s++) {
    const dt = s / sampleRate;
    const env = Math.exp(-dt * 12);
    const val = Math.sin(2 * Math.PI * arpFreq * dt) * env * 0.09;
    addSample(arpStart + s, val * 0.6, val * 0.85);
  }
}

// 5. Normalize and prevent clipping
let maxPeak = 0;
for (let i = 0; i < totalSamples; i++) {
  const absL = Math.abs(leftChannel[i]);
  const absR = Math.abs(rightChannel[i]);
  if (absL > maxPeak) maxPeak = absL;
  if (absR > maxPeak) maxPeak = absR;
}

const targetPeak = 0.88;
const gain = maxPeak > 0 ? targetPeak / maxPeak : 1;

// Write 16-bit stereo PCM WAV
const numChannels = 2;
const bytesPerSample = 2;
const blockAlign = numChannels * bytesPerSample;
const byteRate = sampleRate * blockAlign;
const dataSize = totalSamples * blockAlign;
const wavBuffer = Buffer.alloc(44 + dataSize);

// RIFF header
wavBuffer.write('RIFF', 0);
wavBuffer.writeUInt32LE(36 + dataSize, 4);
wavBuffer.write('WAVE', 8);
wavBuffer.write('fmt ', 12);
wavBuffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
wavBuffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
wavBuffer.writeUInt16LE(numChannels, 22);
wavBuffer.writeUInt32LE(sampleRate, 24);
wavBuffer.writeUInt32LE(byteRate, 28);
wavBuffer.writeUInt16LE(blockAlign, 32);
wavBuffer.writeUInt16LE(16, 34); // BitsPerSample
wavBuffer.write('data', 36);
wavBuffer.writeUInt32LE(dataSize, 40);

let offset = 44;
for (let i = 0; i < totalSamples; i++) {
  const l = Math.max(-1, Math.min(1, leftChannel[i] * gain));
  const r = Math.max(-1, Math.min(1, rightChannel[i] * gain));
  const intL = l < 0 ? l * 0x8000 : l * 0x7FFF;
  const intR = r < 0 ? r * 0x8000 : r * 0x7FFF;
  wavBuffer.writeInt16LE(Math.floor(intL), offset);
  wavBuffer.writeInt16LE(Math.floor(intR), offset + 2);
  offset += 4;
}

const outputDir = path.resolve(process.cwd(), 'public/assets/audio');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const wavPath = path.join(outputDir, 'bg_music.wav');
fs.writeFileSync(wavPath, wavBuffer);
console.log(`Wrote WAV: ${wavPath} (${(wavBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);

// Encode to MP3 using ffmpeg
const mp3Path = path.join(outputDir, 'bg_music.mp3');
const mp3PathAlias1 = path.join(outputDir, 'bg_music_1.mp3');
const mp3PathAlias2 = path.join(outputDir, 'bg_music_2.mp3');

try {
  execSync(`ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -qscale:a 2 "${mp3Path}"`);
  console.log(`Encoded MP3: ${mp3Path}`);
  fs.copyFileSync(mp3Path, mp3PathAlias1);
  fs.copyFileSync(mp3Path, mp3PathAlias2);
  console.log(`Copied aliases to ${mp3PathAlias1} and ${mp3PathAlias2}`);
} catch (err) {
  console.error('ffmpeg conversion error:', err);
  // Fallback: copy wav to mp3 so browser still handles it smoothly
  fs.copyFileSync(wavPath, mp3Path);
  fs.copyFileSync(wavPath, mp3PathAlias1);
  fs.copyFileSync(wavPath, mp3PathAlias2);
}
