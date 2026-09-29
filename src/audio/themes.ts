/**
 * Music for the three ecological powers. Each theme is written in the score's
 * own harmonic-series tuning over its current root, so it belongs to the same
 * piece; its bus follows the power's intensity, fading in over the regular
 * score and handing back to it as the power ends.
 *
 * - Storm: war-drum toms in 3+3+2, a churning filtered growl, a howling
 *   choir on the 7th and 11th overtones, and brass swells.
 * - Wildfire: a quick heartbeat, crackling percussion, a rising arpeggio that
 *   brightens with the fire, over a warm drone.
 * - Drought: slow and sparse; a dry pluck, a wavering heat shimmer, a thin
 *   drone, dust, and a slow clock.
 */

export type ThemeId = 'storm' | 'fire' | 'drought';

interface Voice {
  readonly stop: (at: number) => void;
}

/** What a theme needs from the score. */
export interface ThemeHost {
  readonly ctx: AudioContext;
  /** The world bus (muffled underground). */
  readonly out: AudioNode;
  /** Reverb input. */
  readonly verb: AudioNode;
  readonly noise: AudioBuffer;
  /** The score's current root, in Hz. */
  root(): number;
}

const TEMPO: Record<ThemeId, number> = { storm: 84, fire: 100, drought: 60 };
/** Steps per beat: storm and fire count eighths, drought counts beats. */
const DIVISION: Record<ThemeId, number> = { storm: 2, fire: 2, drought: 1 };

export class Theme {
  readonly bus: GainNode;
  private voices: Voice[] = [];
  private nextStep = 0;
  private step = 0;
  private silentSince = 0;
  private intensity = 0;
  private readonly host: ThemeHost;
  readonly id: ThemeId;

  constructor(host: ThemeHost, id: ThemeId) {
    this.host = host;
    this.id = id;
    const { ctx } = host;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(host.out);
    const send = ctx.createGain();
    send.gain.value = id === 'drought' ? 0.6 : 0.35;
    this.bus.connect(send).connect(host.verb);
  }

  /** Follow the power's intensity; schedule the next notes a little ahead. */
  update(intensity: number): void {
    const { ctx } = this.host;
    const now = ctx.currentTime;
    this.intensity = intensity;
    this.bus.gain.setTargetAtTime(intensity > 0.01 ? Math.min(1, intensity) ** 0.7 : 0, now, 3);
    if (intensity > 0.01) {
      this.silentSince = now;
      if (this.voices.length === 0) this.begin(now);
    } else if (this.voices.length > 0 && now - this.silentSince > 16) {
      // Fully faded: stop the held voices so a quiet forest costs nothing.
      for (const voice of this.voices) voice.stop(now + 0.1);
      this.voices = [];
      return;
    }
    if (this.voices.length === 0) return;
    const stepLength = 60 / TEMPO[this.id] / DIVISION[this.id];
    if (this.nextStep < now - 0.5) this.nextStep = now + 0.05;
    while (this.nextStep < now + 0.25) {
      this.play(this.step, this.nextStep, stepLength);
      this.step++;
      this.nextStep += stepLength;
    }
  }

  /** Held voices, started when the power begins. */
  private begin(at: number): void {
    const root = this.host.root();
    this.nextStep = at + 0.1;
    this.step = 0;
    if (this.id === 'storm') {
      // The growl: detuned saws through a resonant filter that churns.
      this.voices.push(this.drone([root, root * 1.5], 'sawtooth', 0.05, 5, [260, 700], 0.09));
      // The howl: high overtones through a narrow, sweeping band.
      this.voices.push(this.drone([root * 7, root * 11, root * 7.02], 'sawtooth', 0.012, 11, [900, 2600], 0.06, 'bandpass'));
    } else if (this.id === 'fire') {
      this.voices.push(this.drone([root, root * 2, root * 1.003], 'sawtooth', 0.045, 1.5, [250, 900], 0.05));
    } else {
      this.voices.push(this.drone([root, root * 1.5], 'sine', 0.06, 0.7, [400, 600], 0.03));
      // Heat shimmer: two high sines three hertz apart, beating slowly.
      const shimmer = this.bellFold(16);
      this.voices.push(this.drone([shimmer, shimmer + 3], 'sine', 0.012, 0.7, [6000, 8000], 0.02));
      this.voices.push(this.dust());
    }
  }

  private play(step: number, at: number, length: number): void {
    const root = this.host.root();
    const i = this.intensity;
    if (this.id === 'storm') {
      const s = step % 16;
      if ([0, 3, 6, 10, 12].includes(s)) this.tom(at, root, s === 0 ? 0.3 : 0.2);
      if (i > 0.6 && (s === 14 || s === 15)) this.tom(at, root * 1.5, 0.14);
      const figure = [4, 6, 7, 6, 4, 6, 7, 8];
      this.pluck(at, root * figure[step % 8]!, 0.035, 0.3, 'triangle', 900, (s % 2) * 0.6 - 0.3);
      if (step % 64 === 0) this.swell(at, [2, 3, 3.5].map((h) => root * h), length * 16, 0.045);
      if (step % 64 === 32) this.swell(at, [2, 3.5, 5.5].map((h) => root * h), length * 16, 0.04);
    } else if (this.id === 'fire') {
      const s = step % 16;
      if (s % 8 === 0) this.kick(at, 0.28);
      if (s % 8 === 1) this.kick(at, 0.16);
      this.tick(at, 0.02 + Math.random() * 0.05 * (0.4 + i), 3200 + Math.random() * 3000);
      const rise = [8, 10, 11, 12, 13, 14, 16, 14];
      const octave = step % 32 < 16 ? 1 : 2;
      this.pluck(at, (root * rise[step % 8]! * octave) / 2, 0.03, 0.45, 'sawtooth', 700 + i * 2400, step % 2 ? 0.5 : -0.5);
      if (step % 32 === 0) this.roar(at, length * 12, 0.08 * (0.5 + i));
    } else {
      const s = step % 8;
      if (s === 0 || (s === 3 && Math.random() < 0.7) || (s === 5 && Math.random() < 0.4)) {
        const scale = [8, 9, 11, 12, 13, 17];
        this.dryPluck(at, this.pluckFold(scale[Math.floor(Math.random() * scale.length)]!), 0.08);
      }
      if (step % 4 === 0) this.tick(at, 0.02, 1500, true);
    }
  }

  // --- held voices -------------------------------------------------------

  private drone(freqs: number[], type: OscillatorType, level: number, q: number, sweep: [number, number], rate: number, filterType: BiquadFilterType = 'lowpass'): Voice {
    const { ctx } = this.host;
    const at = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.value = (sweep[0] + sweep[1]) / 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = (sweep[1] - sweep[0]) / 2;
    lfo.connect(lfoDepth).connect(filter.frequency);
    const gain = ctx.createGain();
    gain.gain.value = level;
    filter.connect(gain).connect(this.bus);
    const sources: AudioScheduledSourceNode[] = [lfo];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 8;
      osc.connect(filter);
      sources.push(osc);
    }
    for (const s of sources) s.start(at);
    return { stop: (t) => sources.forEach((s) => s.stop(t)) };
  }

  private dust(): Voice {
    const { ctx } = this.host;
    const source = ctx.createBufferSource();
    source.buffer = this.host.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5500;
    const gain = ctx.createGain();
    gain.gain.value = 0.012;
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.09;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.01;
    gust.connect(gustDepth).connect(gain.gain);
    source.connect(filter).connect(gain).connect(this.bus);
    source.start();
    gust.start();
    return { stop: (t) => { source.stop(t); gust.stop(t); } };
  }

  // --- notes ---------------------------------------------------------------

  private envelope(at: number, level: number, attack: number, decay: number): GainNode {
    const g = this.host.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  private tom(at: number, root: number, level: number): void {
    const { ctx } = this.host;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(root * 2.2, at);
    osc.frequency.exponentialRampToValueAtTime(root, at + 0.18);
    const env = this.envelope(at, level, 0.005, 0.6);
    osc.connect(env).connect(this.bus);
    osc.start(at);
    osc.stop(at + 0.7);
    // The skin: a short noise thud.
    this.hit(at, level * 0.4, 'lowpass', 500, 0.08);
  }

  private kick(at: number, level: number): void {
    const { ctx } = this.host;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(130, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    const env = this.envelope(at, level, 0.004, 0.4);
    osc.connect(env).connect(this.bus);
    osc.start(at);
    osc.stop(at + 0.5);
  }

  private hit(at: number, level: number, type: BiquadFilterType, frequency: number, decay: number): void {
    const { ctx } = this.host;
    const source = ctx.createBufferSource();
    source.buffer = this.host.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const env = this.envelope(at, level, 0.002, decay);
    source.connect(filter).connect(env).connect(this.bus);
    source.start(at, Math.random() * 3);
    source.stop(at + decay + 0.05);
  }

  /** A short tick: a crackle (noise) or a clock (a tiny sine). */
  private tick(at: number, level: number, frequency: number, clock = false): void {
    if (!clock) {
      this.hit(at, level, 'highpass', frequency, 0.03 + Math.random() * 0.04);
      return;
    }
    const { ctx } = this.host;
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    const env = this.envelope(at, level, 0.001, 0.03);
    osc.connect(env).connect(this.bus);
    osc.start(at);
    osc.stop(at + 0.06);
  }

  private pluck(at: number, frequency: number, level: number, decay: number, type: OscillatorType, cutoff: number, pan: number): void {
    const { ctx } = this.host;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = this.envelope(at, level, 0.005, decay);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(filter).connect(env).connect(panner).connect(this.bus);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }

  /** A dry, woody pluck: a triangle with a quick inharmonic ping. */
  private dryPluck(at: number, frequency: number, level: number): void {
    this.pluck(at, frequency, level, 1.4, 'triangle', 2200, Math.random() * 1.2 - 0.6);
    this.pluck(at, frequency * 2.76, level * 0.35, 0.18, 'sine', 8000, 0);
    this.hit(at, level * 0.25, 'bandpass', frequency * 4, 0.02);
  }

  private swell(at: number, freqs: number[], length: number, level: number): void {
    const { ctx } = this.host;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, at);
    filter.frequency.linearRampToValueAtTime(1400, at + length * 0.5);
    filter.frequency.linearRampToValueAtTime(300, at + length);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + length * 0.45);
    env.gain.linearRampToValueAtTime(0, at + length);
    filter.connect(env).connect(this.bus);
    for (const f of freqs) {
      for (const cents of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = cents;
        osc.connect(filter);
        osc.start(at);
        osc.stop(at + length + 0.1);
      }
    }
  }

  private roar(at: number, length: number, level: number): void {
    const { ctx } = this.host;
    const source = ctx.createBufferSource();
    source.buffer = this.host.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + length * 0.6);
    env.gain.linearRampToValueAtTime(0, at + length);
    source.connect(filter).connect(env).connect(this.bus);
    source.start(at);
    source.stop(at + length + 0.1);
  }

  private bellFold(harmonic: number): number {
    let f = this.host.root() * harmonic;
    while (f > 1400) f /= 2;
    while (f < 700) f *= 2;
    return f;
  }

  private pluckFold(harmonic: number): number {
    let f = this.host.root() * harmonic;
    while (f > 520) f /= 2;
    while (f < 180) f *= 2;
    return f;
  }
}
