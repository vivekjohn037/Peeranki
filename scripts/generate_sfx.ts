import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const sampleRate = 44100;
const outputDir = path.resolve(process.cwd(), 'public/assets/audio');

function writeWav(filename: string, samples: Float32Array) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const wavBuffer = Buffer.alloc(44 + dataSize);

  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataSize, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20); // PCM
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(16, 34);
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
    wavBuffer.writeInt16LE(Math.floor(intSample), offset);
    offset += 2;
  }

  const wavPath = path.join(outputDir, `${filename}.wav`);
  fs.writeFileSync(wavPath, wavBuffer);

  const mp3Path = path.join(outputDir, `${filename}.mp3`);
  try {
    execSync(`ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -qscale:a 4 "${mp3Path}"`);
  } catch {
    fs.copyFileSync(wavPath, mp3Path);
  }
}

// 1. click (crisp UI tick)
{
  const len = Math.floor(sampleRate * 0.06);
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    arr[i] = Math.sin(2 * Math.PI * 650 * t) * Math.exp(-t * 90);
  }
  writeWav('click', arr);
}

// 2. select (two-tone gentle chime)
{
  const len = Math.floor(sampleRate * 0.16);
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const freq = t < 0.07 ? 480 : 720;
    arr[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 22) * 0.8;
  }
  writeWav('select', arr);
}

// 3. shoot (cannon blast with low-end punch)
{
  const len = Math.floor(sampleRate * 0.35);
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const pitch = 220 * Math.exp(-t * 16) + 40;
    const boom = Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t * 11);
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 20) * 0.45;
    arr[i] = (boom * 0.75 + noise * 0.25);
  }
  writeWav('shoot', arr);
}

// 4. hit (impact clatter)
{
  const len = Math.floor(sampleRate * 0.22);
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const punch = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 28);
    const snap = (Math.random() * 2 - 1) * Math.exp(-t * 35) * 0.4;
    arr[i] = punch * 0.7 + snap;
  }
  writeWav('hit', arr);
}

// 5. elimination (deep echoing drum boom)
{
  const len = Math.floor(sampleRate * 0.5);
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const freq = 160 * Math.exp(-t * 9) + 35;
    arr[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 6) * 0.9;
  }
  writeWav('elimination', arr);
}

// 6. victory (festive fanfare chime)
{
  const len = Math.floor(sampleRate * 0.9);
  const arr = new Float32Array(len);
  const chordNotes = [523.25, 659.25, 783.99, 1046.5];
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    let s = 0;
    chordNotes.forEach((f, idx) => {
      const delay = idx * 0.12;
      if (t >= delay) {
        const dt = t - delay;
        s += Math.sin(2 * Math.PI * f * dt) * Math.exp(-dt * 5) * 0.25;
      }
    });
    arr[i] = s;
  }
  writeWav('victory', arr);
}

console.log('Generated SFX files in public/assets/audio');
