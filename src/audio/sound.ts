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
};
const SINGLES = ["jingle-start", "jingle-tea", "amb-birds", "amb-wind", "music-picnic"];
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
  private buses: Record<"music" | "birds" | "wind" | "sfx", GainNode> | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private listeners = new Set<() => void>();
  private beds: BedLevels = { music: 0.3, birds: 0.35, wind: 0.1 };
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
    this.buses = { music: bus(), birds: bus(), wind: bus(), sfx: bus() };
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
    for (const k of ["music", "birds", "wind"] as const) {
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
