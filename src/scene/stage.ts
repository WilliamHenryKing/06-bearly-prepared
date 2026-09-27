import * as THREE from "three";

// Renderer, scene, camera and lights. One warm key light with soft shadows that follows the
// action, plus a hemisphere fill. AgX tone mapping, DPR capped at 2.

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  readonly key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  readonly fill = new THREE.HemisphereLight(0xd8ecff, 0x6a5a3a, 1.25);
  /** Pixels to shift the subject by so panels do not cover it. */
  private shift = { x: 0, y: 0 };
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement, mobile: boolean) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.fog = new THREE.Fog(0xe9e2cc, 45, 190);
    this.scene.background = new THREE.Color(0xe9e2cc);
    this.key.position.set(8, 14, 6);
    this.key.castShadow = true;
    const size = mobile ? 1024 : 2048;
    this.key.shadow.mapSize.set(size, size);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -9;
    sc.right = sc.top = 9;
    sc.near = 1;
    sc.far = 50;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target, this.fill);
  }

  /** Keep the shadow frustum centred on the subject. */
  follow(target: THREE.Vector3) {
    this.key.target.position.copy(target);
    this.key.position.copy(target).add(new THREE.Vector3(7, 13, 5));
  }

  setShift(x: number, y: number) {
    this.shift = { x, y };
    this.applyView();
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.fov = this.camera.aspect < 0.8 ? 58 : 42;
    this.applyView();
  }

  private applyView() {
    const { width: w, height: h } = this;
    if (this.shift.x || this.shift.y)
      this.camera.setViewOffset(w, h, this.shift.x, this.shift.y, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
