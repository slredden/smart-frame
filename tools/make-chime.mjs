#!/usr/bin/env node
// Writes frame/public/chime.wav: a synthetic two-note bell (no third-party audio, PLAN-v2.md §9.3).
// 8-bit mono PCM at 16 kHz, 0.7 s, about 11 KB. Deterministic, so re-running gives the same bytes.
//   node tools/make-chime.mjs [out]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RATE = 16000;
export const SECONDS = 0.7;

export function chimeSamples() {
  const n = Math.round(RATE * SECONDS);
  const out = new Uint8Array(n);
  const notes = [
    { f: 1318.5, at: 0, amp: 0.55 }, // E6
    { f: 1046.5, at: 0.18, amp: 0.6 }, // C6
  ];
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (const nt of notes) {
      const u = t - nt.at;
      if (u < 0) continue;
      const env = Math.min(1, u / 0.005) * Math.exp(-u * 6);
      v += nt.amp * env * (Math.sin(2 * Math.PI * nt.f * u) + 0.25 * Math.sin(2 * Math.PI * nt.f * 2 * u));
    }
    const fadeOut = Math.min(1, (SECONDS - t) / 0.05);
    out[i] = Math.max(0, Math.min(255, Math.round(128 + 100 * v * fadeOut)));
  }
  return out;
}

export function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length, 40);
  Buffer.from(samples).copy(buf, 44);
  return buf;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || new URL('../frame/public/chime.wav', import.meta.url);
  const b = wav(chimeSamples());
  writeFileSync(out, b);
  console.log('wrote chime.wav,', b.length, 'bytes');
}
