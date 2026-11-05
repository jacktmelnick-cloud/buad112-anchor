/** Sound files generated on startup, so the app ships no audio assets. */

export const SIREN_SAMPLE_RATE = 22_050;

const SIREN_LOW_HZ = 620;
const SIREN_HIGH_HZ = 1350;
const SIREN_SWEEP_SECONDS = 0.9;
const TICK_SECONDS = 0.045;
const TICK_HZ = 2100;

/**
 * Wrap 16-bit mono samples (-1..1) in a WAV header.
 * @param {Float64Array} samples
 * @returns {Buffer}
 */
function encodeWav(samples) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SIREN_SAMPLE_RATE, 24);
  buf.writeUInt32LE(SIREN_SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32_767), 44 + i * 2));
  return buf;
}

/**
 * A two-tone wailing siren (sine sweep up and down).
 * @param {number} seconds
 * @returns {Buffer}
 */
export function sirenWav(seconds) {
  const count = Math.round(seconds * SIREN_SAMPLE_RATE);
  let phase = 0;
  const samples = Float64Array.from({ length: count }, (_, i) => {
    const t = i / SIREN_SAMPLE_RATE;
    const sweep = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (SIREN_SWEEP_SECONDS * 2));
    const freq = SIREN_LOW_HZ + (SIREN_HIGH_HZ - SIREN_LOW_HZ) * sweep;
    phase += (2 * Math.PI * freq) / SIREN_SAMPLE_RATE;
    const fade = Math.min(1, t / 0.02, (seconds - t) / 0.02);
    return 0.55 * Math.sin(phase) * fade;
  });
  return encodeWav(samples);
}

/**
 * A short wooden clock tick.
 * @returns {Buffer}
 */
export function tickWav() {
  const count = Math.round(TICK_SECONDS * SIREN_SAMPLE_RATE);
  const samples = Float64Array.from({ length: count }, (_, i) => {
    const t = i / SIREN_SAMPLE_RATE;
    const envelope = Math.exp(-t * 140);
    return 0.9 * envelope * Math.sin(2 * Math.PI * TICK_HZ * t) * Math.sin(2 * Math.PI * 340 * t + 0.6);
  });
  return encodeWav(samples);
}
