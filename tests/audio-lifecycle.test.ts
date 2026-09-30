import { afterEach, beforeEach, expect, test } from "bun:test";
import { SoundCues } from "../src/audio/cues";
import { createSound, Sound, sound } from "../src/audio/sound";

class NodeFixture {
  disconnected = 0;
  connect<T>(node: T): T {
    return node;
  }
  disconnect() {
    this.disconnected++;
  }
}
const param = () => ({
  value: 0,
  setTargetAtTime: () => {},
  setValueAtTime: () => {},
  linearRampToValueAtTime: () => {},
  exponentialRampToValueAtTime: () => {},
});
class SourceFixture extends NodeFixture {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = param();
  frequency = param();
  onended: (() => void) | null = null;
  at = -1;
  stopped = 0;
  start(at = 0) {
    this.at = at;
  }
  stop(at?: number) {
    if (at === undefined) this.stopped++;
  }
}
const contexts: ContextFixture[] = [];
let decode = async (_data: ArrayBuffer) => ({ duration: 5 }) as AudioBuffer;
class ContextFixture {
  state = "running";
  currentTime = 10;
  sampleRate = 100;
  destination = new NodeFixture();
  nodes: NodeFixture[] = [];
  sources: SourceFixture[] = [];
  closed = 0;
  constructor() {
    contexts.push(this);
  }
  createGain() {
    const node = Object.assign(new NodeFixture(), { gain: param() });
    this.nodes.push(node);
    return node;
  }
  createStereoPanner() {
    const node = Object.assign(new NodeFixture(), { pan: param() });
    this.nodes.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = Object.assign(new NodeFixture(), {
      frequency: param(),
      Q: param(),
      type: "lowpass",
    });
    this.nodes.push(node);
    return node;
  }
  createBufferSource() {
    const source = new SourceFixture();
    this.sources.push(source);
    this.nodes.push(source);
    return source;
  }
  createOscillator() {
    return this.createBufferSource();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(100) };
  }
  decodeAudioData(data: ArrayBuffer) {
    return decode(data);
  }
  async suspend() {
    this.state = "suspended";
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
    this.closed++;
  }
}

const saved = new Map<string, PropertyDescriptor | undefined>();
let signal: AbortSignal | undefined;
let visibility: {
  hidden: boolean;
  handlers: Set<() => void>;
  addEventListener: (_type: string, callback: () => void) => void;
  removeEventListener: (_type: string, callback: () => void) => void;
};
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
beforeEach(() => {
  contexts.length = 0;
  signal = undefined;
  decode = async () => ({ duration: 5 }) as AudioBuffer;
  visibility = {
    hidden: false,
    handlers: new Set(),
    addEventListener: (_type, callback) => visibility.handlers.add(callback),
    removeEventListener: (_type, callback) => visibility.handlers.delete(callback),
  };
  for (const [key, value] of Object.entries({
    document: visibility,
    window: {
      AudioContext: ContextFixture,
      localStorage: { getItem: () => null, setItem: () => {} },
    },
    fetch: async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});
afterEach(() => {
  sound.dispose();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function context() {
  const ctx = contexts.at(-1);
  if (!ctx) throw new Error("Audio was not unlocked");
  return ctx;
}

test("replay cancels future sample/synth cues, while current sound and beds remain", async () => {
  const audio = new Sound();
  audio.unlock();
  await flush();
  const ctx = context();
  expect(ctx.sources.filter((source) => source.loop)).toHaveLength(4);
  audio.play("kettle");
  const playing = ctx.sources.at(-1) as SourceFixture;
  audio.play("kettle", { delay: 2 });
  const queued = ctx.sources.at(-1) as SourceFixture;
  audio.whistle(4);
  const whistle = ctx.sources.slice(-2);
  audio.ping(3);
  const notes = ctx.sources.slice(-2);
  audio.cancelPending();
  expect(playing.stopped).toBe(0);
  expect(queued.stopped).toBe(1);
  expect(
    [...whistle, ...notes].every((source) => source.stopped === 1 && source.disconnected === 1),
  ).toBe(true);
  expect(ctx.sources.filter((source) => source.loop).every((source) => source.stopped === 0)).toBe(
    true,
  );
  playing.onended?.();
  expect(playing.disconnected).toBe(1);
  audio.dispose();
  audio.dispose();
  expect(ctx.closed).toBe(1);
  expect(ctx.nodes.every((node) => node.disconnected === 1)).toBe(true);
  expect(visibility.handlers.size).toBe(0);
  expect(signal?.aborted).toBe(true);
});

test("late decode cannot start ambience after disposal", async () => {
  const finishes: ((buffer: AudioBuffer) => void)[] = [];
  decode = () => new Promise((resolve) => finishes.push(resolve));
  const audio = new Sound();
  audio.unlock();
  await flush();
  const ctx = context();
  audio.dispose();
  for (const finish of finishes) finish({ duration: 5 } as AudioBuffer);
  await flush();
  audio.unlock();
  audio.play("kettle");
  expect(ctx.sources).toHaveLength(0);
  expect((audio as unknown as { buffers: Map<string, AudioBuffer> }).buffers.size).toBe(0);
  expect(ctx.closed).toBe(1);
  expect(visibility.handlers.size).toBe(0);
});

test("HMR creates a fresh live HUD binding and cue reset owns delayed tea sounds", async () => {
  const first = createSound();
  first.unlock();
  await flush();
  const oldContext = context();
  const second = createSound();
  expect(sound).toBe(second);
  expect(second).not.toBe(first);
  expect(oldContext.closed).toBe(1);
  first.unlock();
  expect(contexts).toHaveLength(1);
  second.unlock();
  await flush();
  const cues = new SoundCues(second);
  const ctx = context();
  second.whistle(3);
  cues.reset();
  expect(ctx.sources.slice(-2).every((source) => source.stopped === 1)).toBe(true);
  expect(visibility.handlers.size).toBe(1);
  second.dispose();
});
