import type * as THREE from "three";
import { SceneResources } from "./resources";

export const aborted = () => new DOMException("Scene disposed", "AbortError");

/** Per-scene loading cache; cancelled jobs still release every eventual GPU result. */
export class SceneAssets {
  readonly controller = new AbortController();
  readonly textures = new Map<string, Promise<THREE.Texture>>();
  get signal() {
    return this.controller.signal;
  }

  constructor(readonly resources = new SceneResources()) {}

  assertAlive() {
    if (this.signal.aborted) throw aborted();
  }

  wait<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(aborted());
      if (this.signal.aborted) cancel();
      else this.signal.addEventListener("abort", cancel, { once: true });
      promise.then(
        (value) => {
          this.signal.removeEventListener("abort", cancel);
          if (this.signal.aborted) reject(aborted());
          else resolve(value);
        },
        (error: unknown) => {
          this.signal.removeEventListener("abort", cancel);
          reject(error);
        },
      );
    });
  }

  dispose() {
    this.controller.abort();
    this.textures.clear();
  }
}
