import * as THREE from "three";

type Resource = { dispose(): void };

/** One scene lifetime, including resources that arrive after teardown. */
export class SceneResources {
  private owned = new Set<Resource>();
  private released = new WeakSet<Resource>();
  private retained = new Set<Resource>();
  private closed = false;
  private images = new Set<{ close(): void }>();
  private closedImages = new WeakSet<{ close(): void }>();

  own<T extends Resource>(resource: T): T {
    if (resource instanceof THREE.Texture) this.rememberImages(resource.source.data);
    if (this.closed) this.release(resource);
    else if (!this.released.has(resource)) this.owned.add(resource);
    return resource;
  }

  private rememberImages(value: unknown) {
    if (Array.isArray(value)) {
      for (const entry of value) this.rememberImages(entry);
    } else if (value && typeof (value as { close?: unknown }).close === "function") {
      const bitmap = value as { close(): void };
      if (this.closedImages.has(bitmap)) return;
      if (this.closed) {
        this.closedImages.add(bitmap);
        bitmap.close();
      } else this.images.add(bitmap);
    }
  }

  /** Shared prop materials and source textures survive retirement of one prop. */
  retain<T extends Resource>(resource: T): T {
    if (!this.closed) this.retained.add(resource);
    return this.own(resource);
  }

  private textures(value: unknown, visit: (texture: THREE.Texture) => void) {
    if (value instanceof THREE.Texture) visit(value);
    else if (Array.isArray(value)) for (const entry of value) this.textures(entry, visit);
  }

  material(material: THREE.Material) {
    this.own(material);
    this.materialTextures(material, (texture) => this.own(texture));
  }

  private materialTextures(material: THREE.Material, visit: (texture: THREE.Texture) => void) {
    for (const value of Object.values(material)) this.textures(value, visit);
    const uniforms = (material as THREE.ShaderMaterial).uniforms;
    if (uniforms)
      for (const uniform of Object.values(uniforms)) this.textures(uniform.value, visit);
    const shader = material.userData.shader as THREE.WebGLProgramParametersWithUniforms | undefined;
    if (shader)
      for (const uniform of Object.values(shader.uniforms)) this.textures(uniform.value, visit);
  }

  tree<T extends THREE.Object3D>(root: T): T {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) this.own(mesh.geometry);
      for (const material of this.materials(mesh)) this.material(material);
      if ((object as THREE.InstancedMesh).isInstancedMesh) this.own(object as THREE.InstancedMesh);
      const skeleton = (object as THREE.SkinnedMesh).skeleton;
      if (skeleton) this.own(skeleton);
      const shadow = (object as THREE.Light & { shadow?: THREE.LightShadow }).shadow;
      if (shadow) this.own(shadow);
    });
    return root;
  }

  private materials(mesh: THREE.Mesh) {
    return [
      ...(Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []),
      ...(mesh.customDepthMaterial ? [mesh.customDepthMaterial] : []),
      ...(mesh.customDistanceMaterial ? [mesh.customDistanceMaterial] : []),
    ];
  }

  /** Release a retired piece without invalidating the other pieces' shared maps/materials. */
  retire(root: THREE.Object3D) {
    this.tree(root);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry && !this.retained.has(mesh.geometry)) this.release(mesh.geometry);
      for (const material of this.materials(mesh)) {
        if (this.retained.has(material)) continue;
        this.materialTextures(material, (texture) => {
          if (!this.retained.has(texture)) this.release(texture);
        });
        this.release(material);
      }
      if ((object as THREE.InstancedMesh).isInstancedMesh)
        this.release(object as THREE.InstancedMesh);
    });
    root.removeFromParent();
  }

  release(resource: Resource) {
    if (this.released.has(resource)) return;
    this.released.add(resource);
    this.owned.delete(resource);
    resource.dispose();
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const resource of this.owned) this.release(resource);
    for (const bitmap of this.images) {
      this.closedImages.add(bitmap);
      bitmap.close();
    }
    this.images.clear();
    this.retained.clear();
  }
}
