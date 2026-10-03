// Lens Loop microphone capture: mono float samples → automatic gain → 16 kHz PCM16, 100 ms chunks, level reports.
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.prev = 0; this.out = new Int16Array(1600); this.n = 0; this.box = Math.max(1, Math.round(this.ratio)); this.hist = new Float32Array(this.box); this.hi = 0; this.sum = 0; this.env = 0; this.gain = 1; this.blocks = 0; this.peak = 0; }
  push(v) { const x = Math.max(-1, Math.min(1, v)); this.out[this.n++] = x < 0 ? x * 32768 : x * 32767; if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(1600); this.n = 0; } }
  smooth(v) { if (this.box === 1) return v; this.sum += v - this.hist[this.hi]; this.hist[this.hi] = v; this.hi = (this.hi + 1) % this.box; return this.sum / this.box; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0]; if (!x) return true;
    // automatic gain: quiet voices are lifted towards a comfortable level, loud ones left alone (never clipped)
    let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    const rms = Math.sqrt(s / x.length);
    this.env = Math.max(rms, this.env * 0.9985);
    const want = Math.min(24, Math.max(1, 0.1 / Math.max(this.env, 1e-4)));
    this.gain += (want - this.gain) * 0.05;
    this.peak = Math.max(this.peak, rms * this.gain);
    if (++this.blocks >= 32) { this.port.postMessage({ level: Math.min(1, this.peak) }); this.blocks = 0; this.peak = 0; }
    const g = this.gain;
    if (this.ratio === 1) { for (let i = 0; i < x.length; i++) this.push(x[i] * g); return true; }
    const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = this.smooth(x[i] * g);
    let p = this.pos;
    while (p < y.length - 1) { const i = Math.floor(p), f = p - i; const a = i < 0 ? this.prev : y[i]; this.push(a + (y[i + 1] - a) * f); p += this.ratio; }
    this.pos = p - y.length; this.prev = y[y.length - 1];
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
