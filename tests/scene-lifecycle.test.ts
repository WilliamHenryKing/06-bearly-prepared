import { afterAll, afterEach, describe, expect, test } from "bun:test";
import gsap from "gsap";
import * as THREE from "three";
import { samplePath } from "../src/game/trail";
import { SceneAssets } from "../src/scene/assets";
import { loadBody } from "../src/scene/bear-loader";
import { CameraRig } from "../src/scene/camera";
import { Droplets } from "../src/scene/pond";
import { SceneResources } from "../src/scene/resources";
import { Spills } from "../src/scene/spills";
import { Stage } from "../src/scene/stage";
import type { Ground } from "../src/scene/terrain";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { createElement: () => ({ getContext: () => null }) },
});
const { TeaScene } = await import("../src/scene/tea");
const { propMaterials } = await import("../src/scene/props");
const { sharedTextures } = await import("../src/scene/materials");
const { teaOutcome } = await import("../src/game/tea");

afterAll(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});
afterEach(() => gsap.globalTimeline.clear());

function resources() {
  const owner = new SceneResources();
  for (const material of propMaterials) owner.retain(material);
  for (const texture of sharedTextures) owner.retain(texture);
  return owner;
}

describe("scene resource ownership", () => {
  test("retiring a prop preserves shared material/maps and releases unique pieces once", () => {
    const owner = new SceneResources();
    const texture = owner.retain(new THREE.Texture());
    const shared = owner.retain(new THREE.MeshStandardMaterial({ map: texture }));
    const own = new THREE.MeshStandardMaterial({ normalMap: texture });
    const first = new THREE.Mesh(new THREE.BoxGeometry(), own);
    const other = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    let geometryDisposals = 0;
    let materialDisposals = 0;
    let sharedDisposals = 0;
    let textureDisposals = 0;
    first.geometry.addEventListener("dispose", () => geometryDisposals++);
    own.addEventListener("dispose", () => materialDisposals++);
    shared.addEventListener("dispose", () => sharedDisposals++);
    texture.addEventListener("dispose", () => textureDisposals++);
    owner.tree(other);
    owner.retire(first);
    owner.retire(first);
    expect([geometryDisposals, materialDisposals, sharedDisposals, textureDisposals]).toEqual([
      1, 1, 0, 0,
    ]);
    owner.dispose();
    owner.dispose();
    expect([geometryDisposals, materialDisposals, sharedDisposals, textureDisposals]).toEqual([
      1, 1, 1, 1,
    ]);
  });

  test("shader texture arrays and late resources are released", async () => {
    const owner = new SceneResources();
    const texture = new THREE.Texture();
    const shader = new THREE.ShaderMaterial({
      uniforms: { maps: { value: [texture, [texture]] } },
    });
    let count = 0;
    texture.addEventListener("dispose", () => count++);
    owner.material(shader);
    const assets = new SceneAssets(owner);
    let finish: (texture: THREE.Texture) => void = () => {};
    const result = new Promise<THREE.Texture>((resolve) => {
      finish = resolve;
    }).then((late) => owner.own(late));
    const waiting = assets.wait(result);
    assets.dispose();
    owner.dispose();
    await expect(waiting).rejects.toHaveProperty("name", "AbortError");
    const late = new THREE.Texture();
    let lateDisposals = 0;
    late.addEventListener("dispose", () => lateDisposals++);
    finish(late);
    await result;
    owner.own(late);
    expect([count, lateDisposals]).toEqual([1, 1]);
  });

  test("shared decoded images close once at teardown, including late arrivals", () => {
    const owner = new SceneResources();
    let closed = 0;
    const bitmap = { close: () => closed++ };
    const source = new THREE.Texture();
    source.source.data = bitmap;
    owner.retain(source);
    const clone = source.clone();
    const piece = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ map: clone }),
    );
    owner.retire(piece);
    expect(closed).toBe(0);
    owner.dispose();
    owner.dispose();
    expect(closed).toBe(1);
    let lateClosed = 0;
    const late = new THREE.Texture();
    late.source.data = { close: () => lateClosed++ };
    owner.own(late);
    owner.own(late);
    expect(lateClosed).toBe(1);
  });
});

describe("village asset ownership", () => {
  const originalLoad = THREE.TextureLoader.prototype.loadAsync;
  afterEach(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoad;
  });

  test("importing village does not start unowned texture requests; failed startup rejects ready", async () => {
    const failure = new Event("error");
    const requests: string[] = [];
    THREE.TextureLoader.prototype.loadAsync = (url) => {
      requests.push(url);
      return Promise.reject(failure);
    };
    const { Village } = await import("../src/scene/village");
    expect(requests).toHaveLength(0);
    const assets = new SceneAssets();
    const village = new Village(samplePath(), () => 0, assets);
    assets.resources.tree(village.group);
    await expect(village.ready).rejects.toBe(failure);
    expect(requests).toHaveLength(2);
    assets.dispose();
    assets.resources.dispose();
  });

  test("aborting startup settles immediately, releases late textures and never attaches them", async () => {
    const finish: ((texture: THREE.Texture<HTMLImageElement>) => void)[] = [];
    THREE.TextureLoader.prototype.loadAsync = () => new Promise((resolve) => finish.push(resolve));
    const { Village } = await import("../src/scene/village");
    const assets = new SceneAssets();
    const village = new Village(samplePath(), () => 0, assets);
    assets.resources.tree(village.group);
    const before = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
    village.group.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const entry of Array.isArray(material) ? material : material ? [material] : [])
        if (entry instanceof THREE.MeshStandardMaterial) before.set(entry, entry.map);
    });
    assets.dispose();
    assets.resources.dispose();
    await expect(village.ready).rejects.toHaveProperty("name", "AbortError");
    let released = 0;
    for (const resolve of finish) {
      const texture = new THREE.Texture<HTMLImageElement>();
      texture.addEventListener("dispose", () => released++);
      resolve(texture);
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(2);
    for (const [material, map] of before) expect(material.map).toBe(map);
  });

  test("successful startup preserves scanned leaves and bark repeat with one scene owner", async () => {
    const textures: THREE.Texture<HTMLImageElement>[] = [];
    THREE.TextureLoader.prototype.loadAsync = () => {
      const texture = new THREE.Texture<HTMLImageElement>();
      textures.push(texture);
      return Promise.resolve(texture);
    };
    const { Village } = await import("../src/scene/village");
    const assets = new SceneAssets();
    const village = new Village(samplePath(), () => 0, assets);
    assets.resources.tree(village.group);
    await village.ready;
    const maps = new Set<THREE.Texture>();
    village.group.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const entry of Array.isArray(material) ? material : material ? [material] : [])
        if (entry instanceof THREE.MeshStandardMaterial && entry.map) maps.add(entry.map);
    });
    const leaves = textures[0] as THREE.Texture;
    const barkSource = textures[1] as THREE.Texture;
    const bark = [...maps].find(
      (texture) => texture !== barkSource && texture.source === barkSource.source,
    );
    expect(maps.has(leaves)).toBe(true);
    expect(bark?.repeat.toArray()).toEqual([1, 3]);
    let released = 0;
    for (const texture of [leaves, barkSource, bark])
      texture?.addEventListener("dispose", () => released++);
    assets.dispose();
    assets.resources.dispose();
    assets.resources.dispose();
    expect(released).toBe(3);
  });
});

describe("spill / tea replay", () => {
  test("clear removes flying items and dust without releasing shared prop resources", () => {
    const owner = resources();
    const spills = new Spills({ height: () => 0 } as unknown as Ground, owner);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(), propMaterials[0]);
    prop.position.y = 1;
    let disposed = 0;
    prop.geometry.addEventListener("dispose", () => disposed++);
    spills.drop("kettle", prop, new THREE.Vector3(1, 0, 0), false);
    spills.puff(new THREE.Vector3(), 3);
    const dust = spills.group.children.filter(
      (child) => child !== prop && (child as THREE.Mesh).geometry?.type === "SphereGeometry",
    );
    let dustDisposals = 0;
    for (const child of dust)
      ((child as THREE.Mesh).material as THREE.Material).addEventListener(
        "dispose",
        () => dustDisposals++,
      );
    spills.clear();
    spills.clear();
    expect(spills.group.children).toHaveLength(0);
    expect([disposed, dustDisposals]).toEqual([1, 3]);
    owner.dispose();
  });

  test("a mid-spill calm change lands once, stops markers and completes a fetch", () => {
    const owner = resources();
    const spills = new Spills({ height: () => 2 } as unknown as Ground, owner);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(), propMaterials[0]);
    prop.position.y = 4;
    gsap.to(prop.scale, { x: 0.1, duration: 8 });
    let lands = 0;
    spills.onLand = () => lands++;
    spills.drop("kettle", prop, new THREE.Vector3(1, 0, 0), false);
    expect(gsap.getTweensOf(prop.scale)).toHaveLength(0);
    spills.setCalm(true);
    spills.setCalm(true);
    expect(lands).toBe(1);
    expect(prop.position.y).toBeCloseTo(2.02, 6);
    const marker = spills.group.children.find((child) => child !== prop);
    const yaw = marker?.rotation.y;
    spills.update(1);
    expect(marker?.rotation.y).toBe(yaw);
    spills.take("kettle", new THREE.Vector3(0, 5, 0));
    expect(spills.group.children).toHaveLength(0);
    spills.dispose();
    owner.dispose();
  });

  test("clear kills delayed lamp/reveal tweens and releases every steam material", () => {
    const owner = resources();
    const tea = new TeaScene(owner);
    const arrived = ["kettle", "teacups", "lamp"] as const;
    tea.build(teaOutcome(arrived, arrived), false);
    const lamp = tea.group.children.find((child) => (child as THREE.PointLight).isPointLight);
    if (!lamp) throw new Error("Missing tea lamp");
    expect(gsap.getTweensOf(lamp)).toHaveLength(1);
    const steam = tea.group.children.filter(
      (child) => (child as THREE.Mesh).geometry?.type === "SphereGeometry",
    );
    let released = 0;
    for (const child of steam)
      ((child as THREE.Mesh).material as THREE.Material).addEventListener(
        "dispose",
        () => released++,
      );
    tea.clear();
    expect(gsap.getTweensOf(lamp)).toHaveLength(0);
    expect(released).toBe(5);
    expect(tea.group.children).toHaveLength(0);
    expect(tea.pops).toHaveLength(0);
    owner.dispose();
  });

  test("live calm finishes reveals and holds the completed pour", () => {
    const owner = resources();
    const tea = new TeaScene(owner);
    const arrived = ["kettle", "teacups", "lamp"] as const;
    tea.build(teaOutcome(arrived, arrived), false);
    tea.update(3);
    tea.setCalm(true);
    for (const child of tea.group.children.filter((child) => child.userData.item)) {
      expect(child.scale.x).toBeCloseTo(1, 6);
      expect(gsap.getTweensOf(child.scale)).toHaveLength(0);
    }
    const lamp = tea.group.children.find(
      (child) => (child as THREE.PointLight).isPointLight,
    ) as THREE.PointLight;
    expect(lamp.intensity).toBeCloseTo(2.2, 6);
    const kettle = tea.group.getObjectByName("kettle");
    expect(kettle?.rotation.z).toBe(0);
    tea.update(20);
    expect(kettle?.rotation.z).toBe(0);
    tea.clear();
    owner.dispose();
  });

  test("replay clears the actual visible droplet instance transforms", () => {
    const droplets = new Droplets(
      3,
      () => -10,
      () => {},
    );
    droplets.emit(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 1, 0));
    droplets.update(0.01);
    const matrix = new THREE.Matrix4();
    droplets.mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBeGreaterThan(0);
    droplets.clear();
    for (let i = 0; i < 3; i++) {
      droplets.mesh.getMatrixAt(i, matrix);
      expect([matrix.elements[0], matrix.elements[5], matrix.elements[10]]).toEqual([0, 0, 0]);
    }
    droplets.mesh.geometry.dispose();
    (droplets.mesh.material as THREE.Material).dispose();
    droplets.mesh.dispose();
  });
});

describe("camera interruption", () => {
  test("live calm and replay both terminate an in-progress title glide", () => {
    const path = samplePath();
    const camera = new THREE.PerspectiveCamera(42, 1.8, 0.12, 9000);
    const rig = new CameraRig(camera, path);
    rig.update("title", 0, 0.5, 2, false);
    rig.update("pack", 0, 0.5, 0.2, false);
    rig.setCalm(true);
    rig.update("pack", 0, 0.5, 0, false);
    const expected = new THREE.PerspectiveCamera(42, 1.8, 0.12, 9000);
    new CameraRig(expected, path).update("pack", 0, 0.5, 0, false);
    expect(camera.position.distanceTo(expected.position)).toBeLessThan(1e-8);
    expect(camera.quaternion.angleTo(expected.quaternion)).toBeLessThan(1e-7);
    rig.setCalm(false);
    rig.update("title", 0, 0.5, 1, false);
    rig.update("pack", 0, 0.5, 0.2, false);
    rig.snap();
    rig.update("pack", 0, 0.5, 0, false);
    expect(camera.position.distanceTo(expected.position)).toBeLessThan(1e-8);
  });
});

describe("bear worker ownership", () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  afterEach(() => {
    if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
  });

  test("cancellation terminates the worker and settles without a main-thread sculpt", async () => {
    let instance: FakeWorker | undefined;
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: unknown = null;
      onmessageerror: unknown = null;
      stopped = 0;
      constructor() {
        instance = this;
      }
      postMessage() {}
      terminate() {
        this.stopped++;
      }
    }
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
    const controller = new AbortController();
    const ready = loadBody({ base: 0.01, shells: 0.02 }, controller.signal);
    const worker = instance as unknown as FakeWorker;
    controller.abort();
    await expect(ready).rejects.toHaveProperty("name", "AbortError");
    expect(worker.stopped).toBe(1);
    expect(worker.onmessage).toBeNull();
  });

  test("successful workers are also terminated exactly once", async () => {
    let finish: ((event: { data: unknown }) => void) | null = null;
    let stopped = 0;
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: unknown = null;
      onmessageerror: unknown = null;
      postMessage() {
        finish = this.onmessage;
      }
      terminate() {
        stopped++;
      }
    }
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
    const ready = loadBody({ base: 0.01, shells: 0.02 }, new AbortController().signal);
    const body = {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      joints: new Uint8Array(0),
      weights: new Uint8Array(0),
      fur: new Uint8Array(0),
      comb: new Float32Array(0),
      indices: new Uint32Array(0),
    };
    const result: Awaited<ReturnType<typeof loadBody>> = {
      base: body,
      shells: body,
      nose: { positions: body.positions, normals: body.normals, indices: body.indices },
    };
    (finish as unknown as (event: { data: unknown }) => void)({ data: result });
    expect(await ready).toBe(result);
    expect(stopped).toBe(1);
  });
});

describe("renderer lifetime", () => {
  function fixture() {
    const owner = new SceneResources();
    let renders = 0;
    let sizes = 0;
    let cancel = () => {};
    const cancellation = new Promise<void>((resolve) => {
      cancel = resolve;
    });
    let compile = () => Promise.resolve();
    const stage = Object.assign(Object.create(Stage.prototype) as object, {
      disposed: false,
      pendingSize: false,
      cancellation,
      cancelCompile: cancel,
      resources: owner,
      width: 1,
      height: 1,
      pixelRatio: 1,
      renderScale: 1,
      quality: { pixelBudget: 1000000 },
      shift: { x: 0, y: 0 },
      renderer: {
        compileAsync: () => compile(),
        getRenderTarget: () => null,
        setRenderTarget: () => {},
        setPixelRatio: () => {},
        setSize: () => sizes++,
        dispose: () => {},
      },
      composer: {
        passes: [],
        readBuffer: null,
        setPixelRatio: () => {},
        setSize: () => {},
        render: () => renders++,
        dispose: () => {},
      },
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      baker: { dispose: () => {} },
      ao: { gtaoMaterial: new THREE.Material(), blendMaterial: new THREE.Material() },
      bloom: { materialHighPassFilter: new THREE.Material() },
    }) as unknown as Stage;
    return {
      stage,
      get renders() {
        return renders;
      },
      get sizes() {
        return sizes;
      },
      compile: (job: () => Promise<void>) => {
        compile = job;
      },
    };
  }

  test("resize does not clear a painted canvas between render frames", () => {
    const state = fixture();
    state.stage.resize(390, 844);
    expect(state.sizes).toBe(0);
    expect(state.stage.camera.aspect).toBeCloseTo(390 / 844, 8);
    state.stage.render();
    expect([state.sizes, state.renders]).toEqual([1, 1]);
    state.stage.render();
    expect([state.sizes, state.renders]).toEqual([1, 2]);
    state.stage.dispose();
  });

  test("disposing during compile settles immediately and late completion cannot draw", async () => {
    const state = fixture();
    let finish = () => {};
    state.compile(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const later = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    let retired = 0;
    later.geometry.addEventListener("dispose", () => retired++);
    const ready = state.stage.precompile(later);
    state.stage.dispose();
    expect(await ready).toBe(false);
    expect(retired).toBe(1);
    finish();
    await Promise.resolve();
    expect(state.renders).toBe(0);
    state.stage.render();
    expect(state.renders).toBe(0);
  });
});
