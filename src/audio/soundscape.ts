/** A quiet, self-contained generative score. Audio begins only on an explicit gesture. */
export class Soundscape {
  private context?: AudioContext;
  private master?: GainNode;
  private drones: GainNode[] = [];
  enabled = false;

  async toggle(): Promise<boolean> {
    if (!this.context) this.create();
    await this.context!.resume();
    this.enabled = !this.enabled;
    this.master!.gain.setTargetAtTime(this.enabled ? 0.16 : 0, this.context!.currentTime, 0.8);
    return this.enabled;
  }

  private create(): void {
    const ctx = this.context = new AudioContext();
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const delay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    delay.delayTime.value = 0.73;
    feedback.gain.value = 0.25;
    delay.connect(feedback).connect(delay);
    delay.connect(master);
    for (const [i, frequency] of [65.406, 98, 130.813, 196, 293.665].entries()) {
      const voice = ctx.createOscillator();
      voice.type = 'sine';
      voice.frequency.value = frequency;
      voice.detune.value = i % 2 ? -4 : 3;
      const gain = ctx.createGain();
      gain.gain.value = i < 2 ? 0.17 : 0.025;
      voice.connect(gain).connect(master);
      gain.connect(delay);
      voice.start();
      this.drones.push(gain);
    }
    // Filtered wind, with a loop boundary that carries no transient.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < samples.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) / 1.02;
      samples[i] = brown * Math.sin(Math.PI * i / samples.length) ** 2;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.2;
    wind.connect(windGain).connect(master);
    wind.start();
  }

  update(bonds: number): void {
    if (!this.context || !this.enabled) return;
    this.drones.forEach((gain, i) => gain.gain.setTargetAtTime(
      i < 2 ? 0.17 : i - 1 <= bonds ? 0.095 : 0.015, this.context!.currentTime, 3));
  }

  chime(kind: 'grow' | 'bond' | 'fruit'): void {
    if (!this.context || !this.enabled) return;
    const ctx = this.context;
    const notes = kind === 'fruit' ? [261.63, 329.63, 392, 523.25] : kind === 'bond' ? [196, 293.66, 392] : [261.63];
    notes.forEach((frequency, i) => {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      const at = ctx.currentTime + i * 0.24;
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(0.18, at + 0.04);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + 3.5);
      oscillator.connect(envelope).connect(this.master!);
      oscillator.start(at);
      oscillator.stop(at + 4);
    });
  }

  suspend(): void { void this.context?.suspend(); }
  resume(): void { if (this.enabled) void this.context?.resume(); }
}
