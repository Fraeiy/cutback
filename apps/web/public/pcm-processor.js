class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const inputRate = options.processorOptions?.inputSampleRate || sampleRate;
    const targetRate = options.processorOptions?.targetSampleRate || 24000;
    this.step = inputRate / targetRate;
    this.cursor = 0;
    this.pending = [];
    this.speaking = false;
    this.hang = 0;
    this.levelTick = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let energy = 0;
    for (let i = 0; i < input.length; i += 1) energy += input[i] * input[i];
    const rms = Math.sqrt(energy / Math.max(1, input.length));
    if (rms > 0.018) {
      this.hang = 10;
      if (!this.speaking) {
        this.speaking = true;
        this.port.postMessage({ type: "vad", speaking: true, rms });
      }
    } else if (this.speaking) {
      this.hang -= 1;
      if (this.hang <= 0) {
        this.speaking = false;
        this.port.postMessage({ type: "vad", speaking: false, rms });
      }
    }
    this.levelTick += 1;
    if (this.levelTick % 8 === 0) this.port.postMessage({ type: "level", rms });

    const out = [];
    while (this.cursor < input.length) {
      const index = Math.floor(this.cursor);
      const sample = input[index] ?? 0;
      const next = input[Math.min(input.length - 1, index + 1)] ?? sample;
      const frac = this.cursor - index;
      out.push(sample + (next - sample) * frac);
      this.cursor += this.step;
    }
    this.cursor -= input.length;
    for (const sample of out) this.pending.push(sample);
    if (this.pending.length >= 2400) {
      const pcm = new Int16Array(this.pending.length);
      for (let i = 0; i < this.pending.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, this.pending[i]));
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)));
      }
      this.pending = [];
      this.port.postMessage({ type: "audio", buffer: pcm.buffer }, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
