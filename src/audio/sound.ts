// Sound: CC0 samples (see README credits) on three Web Audio buses — music, ambience and
// effects — under one master gain. Nothing loads or plays until the first user gesture.
// Mute persists; the context suspends while the tab is hidden; beds duck when paused.

const BANKS: Record<string, number> = {
  "step-grass": 5,
  "step-wood": 3,
  kettle: 2,
  teacups: 2,
  biscuits: 2,
  blanket: 2,
  chair: 2,
  lamp: 2,
  log: 2,
  topple: 2,
  creak: 2,
  cloth: 2,
  flag: 1,
  silence: 1,
  "ui-select": 1,
  "ui-back": 1,
  "ui-tick": 1,
  "ui-confirm": 1,
  splash: 5,
  shake: 1,
};
const SINGLES = [
  "jingle-start",
  "jingle-tea",
  "amb-birds",
  "amb-wind",
  "amb-water",
  "music-picnic",
];
const MUTE_KEY = "bearly-prepared:muted";

export interface PlayOptions {
  gain?: number;
  rate?: number;
  pan?: number;
  delay?: number;
}

export interface BedLevels {
  music: number;
  birds: number;
  wind: number;
  /** The pond lapping, swelling as the bear nears it. */
  water: number;
}

function readMuted() {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<"music" | "birds" | "wind" | "water" | "sfx", GainNode> | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private listeners = new Set<() => void>();
  private beds: BedLevels = { music: 0.3, birds: 0.35, wind: 0.1, water: 0 };
  muted = readMuted();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getMuted = () => this.muted;

  /** Call from a user gesture: creates the context and starts loading. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    const bus = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master as GainNode);
      return g;
    };
    this.buses = { music: bus(), birds: bus(), wind: bus(), water: bus(), sfx: bus() };
    this.buses.sfx.gain.value = 0.9;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
    void this.load();
  }

  private async load() {
    const names = [
      ...Object.entries(BANKS).flatMap(([n, c]) =>
        Array.from({ length: c }, (_, i) => `${n}-${i}`),
      ),
      ...SINGLES,
    ];
    await Promise.all(
      names.map(async (n) => {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}audio/${n}.mp3`);
          const data = await res.arrayBuffer();
          const buf = await (this.ctx as AudioContext).decodeAudioData(data);
          this.buffers.set(n, buf);
          if (n === "music-picnic") this.loop(n, "music");
          else if (n === "amb-birds") this.loop(n, "birds");
          else if (n === "amb-wind") this.loop(n, "wind");
          else if (n === "amb-water") this.loop(n, "water");
        } catch {
          // A missing sample just stays silent.
        }
      }),
    );
  }

  private loop(name: string, bus: keyof BedLevels) {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf || !this.buses) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Skip MP3 encoder padding at both ends so the loop is seamless.
    src.loopStart = 0.06;
    src.loopEnd = buf.duration - 0.06;
    src.connect(this.buses[bus]);
    src.start(0, 0.06);
    this.applyBeds(1.5);
  }

  /** Target levels for music and ambience; eased so changes never click. */
  setBeds(levels: Partial<BedLevels>, ease = 0.4) {
    Object.assign(this.beds, levels);
    this.applyBeds(ease);
  }

  private applyBeds(ease: number) {
    if (!this.ctx || !this.buses) return;
    const t = this.ctx.currentTime;
    for (const k of ["music", "birds", "wind", "water"] as const) {
      const ready = this.buffers.has(k === "music" ? "music-picnic" : `amb-${k}`);
      this.buses[k].gain.setTargetAtTime(ready ? this.beds[k] : 0, t, ease);
    }
  }

  play(name: string, o: PlayOptions = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.buses || this.muted || ctx.state !== "running") return;
    const count = BANKS[name];
    const key = count ? `${name}-${Math.floor(Math.random() * count)}` : name;
    const buf = this.buffers.get(key);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.94 + Math.random() * 0.12);
    const gain = ctx.createGain();
    gain.gain.value = o.gain ?? 1;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    src.connect(gain).connect(pan).connect(this.buses.sfx);
    src.start(ctx.currentTime + (o.delay ?? 0));
  }

  /** A synthesised kettle whistle: a breathy sine that rises and wavers. */
  whistle(delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.buses || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1300, t);
    osc.frequency.exponentialRampToValueAtTime(2100, t + 0.9);
    lfo.frequency.value = 7;
    depth.gain.value = 25;
    lfo.connect(depth).connect(osc.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.5);
    g.gain.setValueAtTime(0.05, t + 1.4);
    g.gain.linearRampToValueAtTime(0, t + 1.9);
    osc.connect(g).connect(this.buses.sfx);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 2);
    lfo.stop(t + 2);
  }

  /** A synthesised voice: an oscillator through a filter, with an envelope, panned. */
  private voice(
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
    filter: { type: BiquadFilterType; f: number; q: number } | null,
    pan = 0,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    let node: AudioNode = osc;
    if (filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = filter.type;
      bq.frequency.value = filter.f;
      bq.Q.value = filter.q;
      node = node.connect(bq);
    }
    node.connect(g).connect(p).connect(this.buses.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise: rustling leaves, a whoosh of air. */
  private noise(t: number, dur: number, peak: number, f0: number, f1: number, q: number, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i * 0.013) ** 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bq = ctx.createBiquadFilter();
    bq.type = "bandpass";
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(bq).connect(g).connect(p).connect(this.buses.sfx);
    src.start(t);
  }

  private ready() {
    return this.ctx && this.buses && !this.muted && this.ctx.state === "running";
  }

  /** The goose: two nasal blasts, the second lower ("HONK-onk"). */
  honk(delay = 0, pan = 0, gain = 1) {
    if (!this.ready()) return;
    const t = (this.ctx as AudioContext).currentTime + delay;
    const f = 380 + Math.random() * 60;
    this.voice(
      t,
      "sawtooth",
      f,
      f * 0.86,
      0.19,
      0.11 * gain,
      { type: "bandpass", f: 1150, q: 3.5 },
      pan,
    );
    this.voice(
      t,
      "square",
      f * 0.5,
      f * 0.45,
      0.19,
      0.035 * gain,
      { type: "lowpass", f: 900, q: 1 },
      pan,
    );
    this.voice(
      t + 0.24,
      "sawtooth",
      f * 0.9,
      f * 0.74,
      0.16,
      0.09 * gain,
      { type: "bandpass", f: 1000, q: 3.5 },
      pan,
    );
  }

  /** A phone notification: two bright blips. */
  ping(delay = 0, pan = 0, gain = 1) {
    if (!this.ready()) return;
    const t = (this.ctx as AudioContext).currentTime + delay;
    const base = [1568, 1760, 2093][Math.floor(Math.random() * 3)] as number;
    this.voice(t, "sine", base, base, 0.09, 0.05 * gain, null, pan);
    this.voice(t + 0.1, "sine", base * 1.335, base * 1.335, 0.12, 0.045 * gain, null, pan);
  }

  /** Leaves shaken. */
  rustle(delay = 0, pan = 0, gain = 1) {
    if (!this.ready()) return;
    const t = (this.ctx as AudioContext).currentTime + delay;
    this.noise(t, 0.45, 0.16 * gain, 5200, 2600, 1.4, pan);
    this.noise(t + 0.12, 0.3, 0.1 * gain, 3800, 2200, 1.2, pan);
  }

  /** A soft, heavy thud (a landing; an apple on a head). */
  thud(delay = 0, gain = 1, pitch = 1) {
    if (!this.ready()) return;
    const t = (this.ctx as AudioContext).currentTime + delay;
    this.voice(t, "sine", 120 * pitch, 55 * pitch, 0.18, 0.28 * gain, null);
    this.noise(t, 0.08, 0.08 * gain, 900, 300, 0.8);
  }

  /** Air rushing past (a jump). */
  whoosh(delay = 0, gain = 1) {
    if (!this.ready()) return;
    const t = (this.ctx as AudioContext).currentTime + delay;
    this.noise(t, 0.35, 0.07 * gain, 700, 1900, 0.9);
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      // Not persisted: fine.
    }
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    for (const l of this.listeners) l();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
  }
}

export const sound = new Sound();
