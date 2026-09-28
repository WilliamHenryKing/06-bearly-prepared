/// <reference lib="webworker" />
import { buildBody, buildNose } from "./bear-body";

// Builds the bear's meshes off the main thread: the base body, the coarser shell mesh the fur is
// drawn on, and the nose. Voxel sizes come from the quality tier.

self.onmessage = (e: MessageEvent<{ base: number; shells: number }>) => {
  const base = buildBody(e.data.base);
  const shells = buildBody(e.data.shells);
  const nose = buildNose();
  const buffers = [base, shells, nose].flatMap((m) =>
    Object.values(m).map((a) => (a as ArrayBufferView).buffer),
  );
  (self as unknown as Worker).postMessage({ base, shells, nose }, buffers as ArrayBuffer[]);
};
