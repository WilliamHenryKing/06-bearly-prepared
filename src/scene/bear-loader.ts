import { aborted } from "./assets";
import type { BodyMesh, PlainMesh } from "./bear-body";

interface BodyResult {
  base: BodyMesh;
  shells: BodyMesh;
  nose: PlainMesh;
}

/** Terminate on success, error and cancellation; cancellation never starts the CPU fallback. */
export async function loadBody(
  voxels: { base: number; shells: number },
  signal: AbortSignal,
): Promise<BodyResult> {
  if (signal.aborted) throw aborted();
  let worker: Worker | undefined;
  let cancel: (() => void) | undefined;
  try {
    worker = new Worker(new URL("./bear-body.worker.ts", import.meta.url), { type: "module" });
    const active = worker;
    return await new Promise<BodyResult>((resolve, reject) => {
      cancel = () => reject(aborted());
      const finish = (action: () => void) => {
        if (cancel) signal.removeEventListener("abort", cancel);
        action();
      };
      active.onmessage = (event) => finish(() => resolve(event.data as BodyResult));
      active.onerror = (event) =>
        finish(() => reject(new Error(event.message || "Bear worker failed")));
      active.onmessageerror = () => finish(() => reject(new Error("Invalid bear worker result")));
      signal.addEventListener("abort", cancel, { once: true });
      active.postMessage(voxels);
    });
  } catch (error) {
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    }
    if (signal.aborted) throw aborted();
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // No usable module worker: preserve the authored fallback behind the loader.
    const { buildBody, buildNose } = await import("./bear-body");
    if (signal.aborted) throw aborted();
    return { base: buildBody(voxels.base), shells: buildBody(voxels.shells), nose: buildNose() };
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
  }
}
