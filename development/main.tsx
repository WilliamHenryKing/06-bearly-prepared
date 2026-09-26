import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  TorusKnotGeometry,
  WebGLRenderer,
} from "three";
import "./style.css";

function EnvironmentCheck() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Preparing WebGL");
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      setStatus("WebGL unavailable — build tooling is still usable");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(280, 200);
    element.append(renderer.domElement);
    const scene = new Scene();
    scene.background = new Color("#e6e8e5");
    const camera = new PerspectiveCamera(35, 1.4, 0.1, 30);
    camera.position.set(0, 0, 6);
    const geometry = new TorusKnotGeometry(0.7, 0.2, 72, 12);
    const material = new MeshStandardMaterial({ color: "#406258", roughness: 0.3 });
    const object = new Mesh(geometry, material);
    scene.add(object, new HemisphereLight(0xffffff, 0x405040, 2));
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(3, 4, 2);
    scene.add(light);
    const draw = () => renderer.render(scene, camera);
    draw();
    setStatus("React + WebGL ready");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tween = gsap.to(object.rotation, {
      y: 0.8,
      duration: motion ? 0 : 0.8,
      onUpdate: draw,
      onComplete: () => setStatus("React + WebGL + GSAP ready"),
    });
    return () => {
      tween.kill();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p>LOCAL DEVELOPMENT TOOLING</p>
      <h1>BEARLY PREPARED</h1>
      <p>This is a toolchain check. Project artwork and features are not implemented here.</p>
      <div ref={host} />
      <p role="status">{status}</p>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Verify React interaction: {clicks}
      </button>
      <p>Vite · React · TypeScript · direct Three.js · GSAP · Tailwind · Lightning CSS</p>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<EnvironmentCheck />);
