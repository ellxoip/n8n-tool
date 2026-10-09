class VoiceSampler extends AudioWorkletProcessor {
  constructor() {
    super(); this.enabled = false; this.ratio = sampleRate / 16000;
    this.hpAlpha = Math.exp(-2 * Math.PI * 120 / 16000); this.lpAlpha = 1 - Math.exp(-2 * Math.PI * 3600 / 16000);
    this.reset(); this.port.onmessage = event => { this.enabled = event.data.enabled; this.reset(); };
  }
  reset() {
    this.position = this.sum = this.count = this.previous = this.high = this.low = 0;
    this.frame = new Float32Array(320); this.index = this.rawPower = this.bandPower = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0]; if (!this.enabled || !input) return true;
    for (const sample of input) {
      this.sum += sample; this.count++; this.position++;
      if (this.position < this.ratio) continue;
      this.position -= this.ratio;
      const value = this.sum / this.count; this.sum = this.count = 0;
      this.high = this.hpAlpha * (this.high + value - this.previous); this.previous = value;
      this.low += this.lpAlpha * (this.high - this.low); this.frame[this.index++] = this.low;
      this.rawPower += value * value; this.bandPower += this.low * this.low;
      if (this.index === 320) {
        const pcm = this.frame;
        this.port.postMessage({ pcm, rms: Math.sqrt(this.bandPower / 320), bandRatio: this.bandPower / Math.max(this.rawPower, 1e-10) }, [pcm.buffer]);
        this.frame = new Float32Array(320); this.index = this.rawPower = this.bandPower = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-sampler', VoiceSampler);
