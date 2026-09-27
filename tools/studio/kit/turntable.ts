// Studio turntable: renders one studio model at a time on a physically lit product stage
// (room environment, soft-shadowed key, rim, shadow-catcher floor, AgX), or as a black
// silhouette under a lamp for shadow-play atlases. Driven by tools/studio/kit/render.mjs.
import {
  AgXToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
const key = new DirectionalLight(0xfff0dc, 2.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.015;
key.shadow.radius = 5;
const rim = new DirectionalLight(0xdce8ff, 1.3);
scene.add(key, key.target, rim, rim.target);
const floor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.3 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const holder = new Group();
scene.add(holder);
const camera = new PerspectiveCamera(26, 1, 0.01, 1000);
const silhouetteCamera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Vertex colours carry albedo; _MATERIAL carries roughness, metalness, baked AO and wear.
const surface = new MeshStandardMaterial({ vertexColors: true });
surface.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec4 _material;\nvarying vec4 vStudio;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStudio = _material;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec4 vStudio;")
    .replace("#include <roughnessmap_fragment>", "float roughnessFactor = clamp(vStudio.r, 0.05, 1.0);")
    .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vStudio.g;")
    .replace(
      "#include <aomap_fragment>",
      "reflectedLight.indirectDiffuse *= mix(1.0, vStudio.b, 0.85);\nreflectedLight.indirectSpecular *= mix(1.0, vStudio.b, 0.6);",
    );
};
surface.customProgramCacheKey = () => "studio-surface";
const shadowInk = new MeshBasicMaterial({ color: 0x000000 });

let current: Object3D | null = null;
let radius = 1;
let centreY = 1;
let floorY = 0;
let background = new Color(0x2a2d31);

async function load(url: string) {
  if (current) {
    holder.remove(current);
    current.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
  }
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o instanceof Mesh) {
      o.material = surface;
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const bounds = new Box3().setFromObject(model);
  const centre = bounds.getCenter(new Vector3());
  model.position.set(-centre.x, -bounds.min.y, -centre.z);
  holder.add(model);
  current = model;
  const placed = new Box3().setFromObject(holder);
  const sphere = placed.getBoundingSphere(new Sphere());
  radius = sphere.radius;
  centreY = (placed.min.y + placed.max.y) / 2;
  floorY = 0;
  floor.scale.setScalar(radius * 8);
  floor.position.y = floorY;
  return { radius, height: bounds.max.y - bounds.min.y };
}

type RenderOptions = { angles: number[]; size: number; elevation?: number; mode?: "beauty" | "silhouette" };
function render({ angles, size, elevation = 20, mode = "beauty" }: RenderOptions) {
  renderer.setSize(size, size, false);
  const frames: string[] = [];
  for (const angle of angles) {
    holder.rotation.y = (angle * Math.PI) / 180;
    if (mode === "silhouette") {
      scene.background = new Color(0xffffff);
      scene.overrideMaterial = shadowInk;
      floor.visible = false;
      const r = radius * 1.08;
      silhouetteCamera.left = -r;
      silhouetteCamera.right = r;
      silhouetteCamera.top = centreY + r;
      silhouetteCamera.bottom = centreY - r;
      silhouetteCamera.position.set(0, centreY, radius * 6);
      silhouetteCamera.lookAt(0, centreY, 0);
      silhouetteCamera.updateProjectionMatrix();
      renderer.render(scene, silhouetteCamera);
    } else {
      scene.background = background;
      scene.overrideMaterial = null;
      floor.visible = true;
      const e = (elevation * Math.PI) / 180;
      const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.02;
      camera.aspect = 1;
      camera.position.set(0, centreY + Math.sin(e) * distance, Math.cos(e) * distance);
      camera.near = distance / 50;
      camera.far = distance * 10;
      camera.updateProjectionMatrix();
      camera.lookAt(0, centreY, 0);
      key.position.set(-radius * 3, radius * 5, radius * 4);
      key.target.position.set(0, centreY, 0);
      const s = radius * 1.6;
      key.shadow.camera.left = -s;
      key.shadow.camera.right = s;
      key.shadow.camera.top = s;
      key.shadow.camera.bottom = -s;
      key.shadow.camera.near = 0.01;
      key.shadow.camera.far = radius * 14;
      key.shadow.camera.updateProjectionMatrix();
      rim.position.set(radius * 4, radius * 2.5, -radius * 5);
      rim.target.position.set(0, centreY, 0);
      renderer.render(scene, camera);
    }
    frames.push(renderer.domElement.toDataURL("image/png"));
  }
  scene.overrideMaterial = null;
  return frames;
}

const api = {
  ready: Promise.resolve(true),
  setBackground(hex: number) {
    background = new Color(hex);
  },
  load,
  render,
};
(window as unknown as { __STUDIO__: typeof api }).__STUDIO__ = api;
