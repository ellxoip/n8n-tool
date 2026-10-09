// Local activity detector, bounded to one utterance plus 260 ms of pre-roll.
export class VoiceDetector {
  constructor({ silenceMs = 1100, sensitivity = 2.8, maxMs = 45000 } = {}) {
    Object.assign(this, { silenceMs, sensitivity, maxMs }); this.reset();
  }
  reset() {
    Object.assign(this, { noise: 0.002, calibration: 0, preRoll: [], frames: [], active: false, candidate: 0, voicedMs: 0, quietMs: 0, durationMs: 0 });
  }
  push({ pcm, rms, bandRatio }) {
    const ms = pcm.length / 16;
    if (this.calibration < 600) {
      this.calibration += ms;
      if (rms < 0.015) this.noise = this.noise * 0.9 + rms * 0.1;
      return { state: 'calibrating', level: rms };
    }
    const threshold = Math.max(0.007, this.noise * this.sensitivity);
    const voiced = rms > threshold && bandRatio > 0.2;
    if (!this.active) {
      this.preRoll.push(pcm); if (this.preRoll.length > 13) this.preRoll.shift();
      this.candidate = voiced ? this.candidate + ms : 0;
      if (!voiced && rms < threshold) this.noise = Math.max(0.001, this.noise * 0.995 + rms * 0.005);
      if (this.candidate < 60) return { state: 'listening', level: rms };
      this.active = true; this.frames = this.preRoll; this.preRoll = [];
      this.durationMs = this.frames.reduce((n, f) => n + f.length / 16, 0);
      this.voicedMs = this.candidate; this.quietMs = 0;
      return { state: 'recording', level: rms, durationMs: this.durationMs };
    }
    this.frames.push(pcm); this.durationMs += ms;
    if (voiced) { this.voicedMs += ms; this.quietMs = 0; } else this.quietMs += ms;
    if (this.quietMs < this.silenceMs && this.durationMs < this.maxMs) return { state: 'recording', level: rms, durationMs: this.durationMs };
    const frames = this.frames, trimSamples = Math.max(0, Math.floor((this.quietMs - 180) * 16));
    const accepted = this.voicedMs >= 240;
    this.frames = []; this.preRoll = []; this.active = false;
    this.candidate = this.voicedMs = this.quietMs = this.durationMs = 0;
    return { state: accepted ? 'complete' : 'discarded', frames: accepted ? frames : [], trimSamples, level: rms };
  }
}
export function encodeWav(frames, trimSamples = 0) {
  const samples = Math.max(0, frames.reduce((n, frame) => n + frame.length, 0) - trimSamples);
  const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
  let index = 0;
  for (const frame of frames) for (const sample of frame) {
    if (index >= samples) return buffer;
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index++ * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return buffer;
}
