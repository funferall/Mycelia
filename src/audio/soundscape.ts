/**
 * The score: a slow, generative piece tuned to the natural harmonic series.
 *
 * Every pitch is a whole-number overtone of a low root (A1, 55 Hz), so the
 * music is consonant and calm, but the 7th, 11th and 13th overtones sit
 * between the keys of a piano. That is where the otherworldly colour comes
 * from; nothing is detuned at random.
 *
 * Layers, all synthesised (no audio files):
 * - a breathing pad whose root drifts through a slow cycle of harmonic fields;
 * - sparse glass bells, FM-voiced, drawn from the current field's overtones;
 * - a whispering "breath" of formant-filtered noise that changes vowel;
 * - a soft low pulse, the network's heartbeat, stronger with more bonds;
 * - wind, thunder after lightning, and crackle while fire burns.
 *
 * The world shapes it: underground the whole score is muffled and deeper in
 * reverb; seasons change its brightness and how often bells ring; a storm
 * raises wind and thins the bells; drought thins the pad and silences
 * the bells further. Audio begins only on an explicit gesture.
 */

import { Theme, type ThemeId } from './themes';

/** What the score listens to, once per frame. */
export interface ScoreState {
  /** Trees in a living bond with the player's network. */
  readonly bonds: number;
  /** 0 deep in the soil view, 1 at the forest surface. */
  readonly surface: number;
  readonly season: string;
  /** 0–1 storm intensity. */
  readonly storm: number;
  /** 0–1 wildfire intensity while it burns. */
  readonly fire: number;
  /** 0–1 drought severity. */
  readonly drought: number;
  /** 0–1 lightning flash brightness. */
  readonly lightning: number;
}

const BASE = 55;
/** The root of each harmonic field, as a ratio of A1: A, D, a septimal C, E, G. */
const ROOTS = [1, 4 / 3, 7 / 6, 3 / 2, 8 / 9] as const;
/** Pad partials: [harmonic, level]. 7/2 and 11/2 are the alien colour. */
const PAD: readonly (readonly [number, number])[] = [[1, 0.16], [2, 0.1], [3, 0.055], [3.5, 0.035], [5, 0.018], [5.5, 0.012]];
/** Bell overtones with their weights: mostly consonant, sometimes strange. */
const BELL: readonly (readonly [number, number])[] = [[8, 3], [9, 2], [10, 2], [11, 1.2], [12, 3], [13, 1], [14, 1.4], [15, 0.8], [16, 2]];
/** Formant pairs, for the breath's slow change of vowel: oo, oh, ah, eh. */
const VOWELS = [[300, 870], [450, 800], [730, 1090], [530, 1840]] as const;
const SEASON: Record<string, { bright: number; bells: number }> = {
  spring: { bright: 1.15, bells: 1.25 },
  summer: { bright: 1, bells: 1 },
  autumn: { bright: 0.85, bells: 0.85 },
  winter: { bright: 0.7, bells: 0.55 },
};

interface Field {
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly sources: OscillatorNode[];
}

export class Soundscape {
  private context?: AudioContext;
  private master?: GainNode;
  /** Depth: the whole score is muffled underground. */
  private depth?: BiquadFilterNode;
  /** The pad bus, thinned by drought. */
  private padBus?: BiquadFilterNode;
  private reverb?: GainNode;
  private base?: GainNode;
  private baseVerb?: GainNode;
  private themes: Theme[] = [];
  private previewing: ThemeId | null = null;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  private breathGains: GainNode[] = [];
  private breathFilters: BiquadFilterNode[] = [];
  private noise?: AudioBuffer;
  private analyser?: AnalyserNode;
  private field?: Field;
  private rootIndex = 0;
  private nextField = 0;
  private nextBell = 0;
  private nextPulse = 0;
  private lastFlash = 0;
  enabled = false;

  async toggle(): Promise<boolean> {
    if (!this.context) this.create();
    await this.context!.resume();
    this.enabled = !this.enabled;
    this.master!.gain.setTargetAtTime(this.enabled ? 0.5 : 0, this.context!.currentTime, 0.8);
    return this.enabled;
  }

  /**
   * Listen to one power's theme without the power (`null` ends it). Music
   * only: the world is untouched. From the console:
   * `mycelia.game.sound.preview('storm' | 'fire' | 'drought' | null)`.
   */
  preview(id: ThemeId | null): void {
    this.previewing = id;
  }

  /** Current output level (RMS, 0–1), for tests and a future meter. */
  level(): number {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  }

  private create(): void {
    const ctx = this.context = new AudioContext();
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    // A gentle limiter: the score must never spike, whatever piles up.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.02;
    limiter.release.value = 0.6;
    const analyser = this.analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(limiter).connect(ctx.destination);
    limiter.connect(analyser);

    const depth = this.depth = ctx.createBiquadFilter();
    depth.type = 'lowpass';
    depth.frequency.value = 1800;
    depth.Q.value = 0.5;
    depth.connect(master);

    // A long, darkening hall: the forest as a cathedral, the soil as a cave.
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(ctx, 7);
    const reverb = this.reverb = ctx.createGain();
    reverb.gain.value = 1;
    reverb.connect(convolver).connect(depth);

    // The regular score, dry and sent, dips while a power's theme plays.
    const base = this.base = ctx.createGain();
    base.connect(depth);
    const baseVerb = this.baseVerb = ctx.createGain();
    baseVerb.connect(reverb);

    const padBus = this.padBus = ctx.createBiquadFilter();
    padBus.type = 'highpass';
    padBus.frequency.value = 35;
    padBus.connect(base);
    const padSend = ctx.createGain();
    padSend.gain.value = 0.35;
    padBus.connect(padSend).connect(baseVerb);

    this.noise = noiseBuffer(ctx, 4);
    const host = { ctx, out: depth, verb: reverb, noise: this.noise, root: () => this.root() };
    this.themes = [new Theme(host, 'storm'), new Theme(host, 'fire'), new Theme(host, 'drought')];

    // Wind: brown noise, looped without a transient at the seam.
    const brown = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate);
    const samples = brown.getChannelData(0);
    let b = 0;
    for (let i = 0; i < samples.length; i++) {
      b = (b + (Math.random() * 2 - 1) * 0.02) / 1.02;
      samples[i] = b * 3.5 * Math.sin((Math.PI * i) / samples.length) ** 2;
    }
    for (const offset of [0, 3]) {
      // Two copies half a loop apart hide the swell of each loop.
      const wind = ctx.createBufferSource();
      wind.buffer = brown;
      wind.loop = true;
      wind.connect(this.windFilter ??= ctx.createBiquadFilter());
      wind.start(ctx.currentTime + offset);
    }
    this.windFilter!.type = 'lowpass';
    this.windFilter!.frequency.value = 500;
    const windGain = this.windGain = ctx.createGain();
    windGain.gain.value = 0.1;
    this.windFilter!.connect(windGain).connect(master);

    // Breath: white noise through two narrow formants, swelling slowly.
    for (let i = 0; i < 2; i++) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 18;
      filter.frequency.value = VOWELS[0][i]!;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const swell = ctx.createOscillator();
      swell.frequency.value = 0.021 + i * 0.013;
      const depthOfSwell = ctx.createGain();
      depthOfSwell.gain.value = 0.03;
      swell.connect(depthOfSwell).connect(gain.gain);
      swell.start();
      source.connect(filter).connect(gain);
      gain.connect(base);
      gain.connect(baseVerb);
      source.start();
      this.breathGains.push(gain);
      this.breathFilters.push(filter);
    }

    const now = ctx.currentTime;
    this.startField(now);
    this.nextBell = now + 4;
    this.nextPulse = now + 6;
  }

  /** Called every frame with the world's state; schedules the score ahead. */
  update(state: ScoreState): void {
    if (!this.context || !this.enabled) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const season = SEASON[state.season] ?? SEASON.summer!;
    const surface = clamp(state.surface);

    // The world's filters.
    this.depth!.frequency.setTargetAtTime(1600 + surface ** 1.5 * 10000 * season.bright, now, 0.8);
    this.padBus!.frequency.setTargetAtTime(35 + state.drought * 140, now, 2);
    this.windGain!.gain.setTargetAtTime(0.05 + surface * 0.1 + state.storm * 0.55 + state.drought * 0.06, now, 1.5);
    this.windFilter!.frequency.setTargetAtTime(380 + state.storm * 1400 + surface * 200, now, 1.5);
    this.reverb!.gain.setTargetAtTime(1.3 - surface * 0.5, now, 2);
    for (const gain of this.breathGains) gain.gain.setTargetAtTime(0.045 * (1 - state.storm * 0.4), now, 3);
    if (this.field) {
      const breathing = 500 + 500 * Math.sin(now * 0.037) ** 2;
      this.field.filter.frequency.setTargetAtTime(breathing * season.bright * (1 - state.drought * 0.5), now, 3);
    }

    // A power's theme takes the foreground; the regular score steps back
    // under it and returns as the power fades.
    const powers = { storm: state.storm, fire: state.fire, drought: state.drought };
    if (this.previewing) powers[this.previewing] = 1;
    for (const theme of this.themes) theme.update(powers[theme.id]);
    const duck = 1 - 0.7 * Math.min(1, Math.max(powers.storm, powers.fire, powers.drought));
    this.base!.gain.setTargetAtTime(duck, now, 3);
    this.baseVerb!.gain.setTargetAtTime(duck, now, 3);

    if (now >= this.nextField) this.startField(now);

    if (now >= this.nextBell) {
      const life = 0.6 + Math.min(6, state.bonds) * 0.12;
      const rate = season.bells * life * (1 - state.storm * 0.6) * (1 - state.drought * 0.65);
      this.phrase(now + 0.05, Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1);
      this.nextBell = now + (3 + Math.random() * 7) / Math.max(0.15, rate);
    }

    if (now >= this.nextPulse) {
      this.pulse(now + 0.05, 0.05 + Math.min(6, state.bonds) * 0.018);
      this.nextPulse = now + 8 + Math.random() * 5;
    }

    // Thunder follows each fresh flash, a little late and louder at the surface.
    if (state.lightning > 0.55 && this.lastFlash <= 0.55) {
      this.thunder(now + 0.4 + Math.random() * 1.6, 0.35 + surface * 0.65);
    }
    this.lastFlash = state.lightning;

    // Fire crackles above ground, in small irregular bursts.
    if (state.fire > 0 && surface > 0.2 && Math.random() < state.fire * surface * 0.5) {
      this.crackle(now + Math.random() * 0.05, 0.04 + Math.random() * 0.1 * state.fire);
    }
  }

  /** Cue a moment of play in the score's own tuning. */
  chime(kind: 'grow' | 'bond' | 'fruit' | 'spores'): void {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    // Spores: a quick rising scatter, the only cue that climbs past the octave.
    const overtones = kind === 'spores' ? [8, 9, 11, 12, 13, 14, 16, 18, 22] : kind === 'fruit' ? [8, 10, 12, 14, 16] : kind === 'bond' ? [12, 14, 16] : [12];
    if (kind === 'spores') {
      overtones.forEach((h, i) => this.bell(this.bellFrequency(h) * (i > 5 ? 2 : 1), now + i * 0.11, 0.05, Math.sin(i * 1.7) * 0.8));
      return;
    }
    overtones.forEach((h, i) => this.bell(this.bellFrequency(h), now + i * 0.28, kind === 'grow' ? 0.05 : 0.09, (i / overtones.length - 0.5) * 0.8));
  }

  suspend(): void { void this.context?.suspend(); }
  resume(): void { if (this.enabled) void this.context?.resume(); }

  private root(): number {
    return BASE * ROOTS[this.rootIndex % ROOTS.length]!;
  }

  /** A bell overtone of the current root, folded into its singing range. */
  private bellFrequency(harmonic: number): number {
    let f = (this.root() * harmonic) / 2;
    while (f > 1250) f /= 2;
    while (f < 320) f *= 2;
    return f;
  }

  /** Crossfade to the next harmonic field. */
  private startField(at: number): void {
    const ctx = this.context!;
    const old = this.field;
    if (old) {
      old.gain.gain.setTargetAtTime(0, at, 5);
      for (const source of old.sources) source.stop(at + 30);
      this.rootIndex++;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, at, 5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.7;
    filter.connect(gain).connect(this.padBus!);
    const sources: OscillatorNode[] = [];
    const root = this.root();
    for (const [harmonic, level] of PAD) {
      for (const cents of [-4, 3.5]) {
        const osc = ctx.createOscillator();
        osc.type = harmonic <= 2 ? 'sine' : 'triangle';
        osc.frequency.value = root * harmonic;
        osc.detune.value = cents + (Math.random() - 0.5) * 2;
        const voice = ctx.createGain();
        voice.gain.value = level * 0.5;
        // Each partial drifts in and out on its own slow tide.
        const tide = ctx.createOscillator();
        tide.frequency.value = 0.015 + Math.random() * 0.04;
        const tideDepth = ctx.createGain();
        tideDepth.gain.value = level * 0.3;
        tide.connect(tideDepth).connect(voice.gain);
        osc.connect(voice).connect(filter);
        osc.start(at);
        tide.start(at);
        sources.push(osc, tide);
      }
    }
    this.field = { gain, filter, sources };
    // The breath changes vowel with the field.
    const vowel = VOWELS[this.rootIndex % VOWELS.length]!;
    this.breathFilters.forEach((f, i) => f.frequency.setTargetAtTime(vowel[i]! * (root / BASE) ** 0.3, at, 6));
    this.nextField = at + 36 + Math.random() * 20;
  }

  /** One to four bells, stepping through nearby overtones. */
  private phrase(at: number, notes: number): void {
    const total = BELL.reduce((v, [, w]) => v + w, 0);
    let pick = Math.random() * total;
    let index = 0;
    while (index < BELL.length - 1 && (pick -= BELL[index]![1]) > 0) index++;
    for (let n = 0; n < notes; n++) {
      const h = BELL[Math.max(0, Math.min(BELL.length - 1, index))]![0];
      this.bell(this.bellFrequency(h), at + n * (0.45 + Math.random() * 0.5), 0.05 + Math.random() * 0.04, Math.random() * 1.4 - 0.7);
      index += Math.random() < 0.5 ? 1 : -1;
    }
  }

  /** A glass bell: FM with an inharmonic 3.5 modulator whose brightness fades. */
  private bell(frequency: number, at: number, level: number, pan: number): void {
    const ctx = this.context!;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = frequency;
    const modulator = ctx.createOscillator();
    modulator.frequency.value = frequency * 3.5;
    const index = ctx.createGain();
    index.gain.setValueAtTime(frequency * 1.6, at);
    index.gain.exponentialRampToValueAtTime(frequency * 0.02, at + 3);
    modulator.connect(index).connect(carrier.frequency);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.03);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 7);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    carrier.connect(envelope).connect(panner);
    panner.connect(this.base!);
    const send = ctx.createGain();
    send.gain.value = 0.8;
    panner.connect(send).connect(this.baseVerb!);
    carrier.start(at);
    modulator.start(at);
    carrier.stop(at + 7.2);
    modulator.stop(at + 7.2);
  }

  /** The heartbeat: a soft sine that sinks an octave, like a signal in the soil. */
  private pulse(at: number, level: number): void {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    const f = this.root();
    osc.frequency.setValueAtTime(f * 2, at);
    osc.frequency.exponentialRampToValueAtTime(f, at + 0.35);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.06);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
    osc.connect(envelope).connect(this.base!);
    osc.start(at);
    osc.stop(at + 1.7);
  }

  /** A roll of thunder: low noise that swells and rumbles away. */
  private thunder(at: number, level: number): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise!;
    source.playbackRate.value = 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, at);
    filter.frequency.exponentialRampToValueAtTime(70, at + 5);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level * 0.9, at + 0.12);
    envelope.gain.exponentialRampToValueAtTime(level * 0.35, at + 1.2);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 6);
    source.connect(filter).connect(envelope).connect(this.master!);
    envelope.connect(this.reverb!);
    source.start(at, Math.random() * 2);
    source.stop(at + 6.2);
  }

  /** One ember crack. */
  private crackle(at: number, level: number): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800 + Math.random() * 2500;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(level, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.03 + Math.random() * 0.05);
    source.connect(filter).connect(envelope).connect(this.master!);
    source.start(at, Math.random() * 3);
    source.stop(at + 0.1);
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A stereo hall whose tail darkens as it decays, falling 60 dB over `seconds`. */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // The one-pole smoothing closes as the tail ages: the highs die first.
      const k = 0.9 - t * 0.85;
      smooth = smooth * (1 - k) + (Math.random() * 2 - 1) * k;
      data[i] = smooth * Math.exp(-6.9 * t) * (i < ctx.sampleRate * 0.02 ? i / (ctx.sampleRate * 0.02) : 1) * 0.5;
    }
  }
  return buffer;
}
