// Lens Loop microphone capture: mono float samples → 16 kHz PCM16, 250 ms chunks.
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.prev = 0; this.out = new Int16Array(4000); this.n = 0; this.box = Math.max(1, Math.round(this.ratio)); this.hist = new Float32Array(this.box); this.hi = 0; this.sum = 0; }
  push(v) { const x = Math.max(-1, Math.min(1, v)); this.out[this.n++] = x < 0 ? x * 32768 : x * 32767; if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(4000); this.n = 0; } }
  smooth(v) { if (this.box === 1) return v; this.sum += v - this.hist[this.hi]; this.hist[this.hi] = v; this.hi = (this.hi + 1) % this.box; return this.sum / this.box; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0]; if (!x) return true;
    if (this.ratio === 1) { for (let i = 0; i < x.length; i++) this.push(x[i]); return true; }
    const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = this.smooth(x[i]);
    let p = this.pos;
    while (p < y.length - 1) { const i = Math.floor(p), f = p - i; const a = i < 0 ? this.prev : y[i]; this.push(a + (y[i + 1] - a) * f); p += this.ratio; }
    this.pos = p - y.length; this.prev = y[y.length - 1];
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
