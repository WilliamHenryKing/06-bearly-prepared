import * as THREE from "three";
import type { PbrSet } from "./textures";

// Meadow ground on top of three's standard material (so shadows, IBL and fog stay exact),
// after ODD TIDE's terrain-material.ts (reused with permission): top-projected turf sampled at
// two scales and blended by a macro field so it never tiles, trail dirt from baked weights near
// the path, and triplanar rock on the ledge and cliff. Vertex colour: r = baked AO,
// g = dirt weight, b = rock weight.

export interface GroundSets {
  turf: PbrSet;
  dirt: PbrSet;
  rock: PbrSet;
}

export function createGroundMaterial(sets: GroundSets) {
  const material = new THREE.MeshStandardMaterial({
    name: "meadow-ground",
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  const maps: Record<string, { value: THREE.Texture }> = {
    turfColour: { value: sets.turf.colour },
    turfNormal: { value: sets.turf.normal },
    turfArm: { value: sets.turf.arm },
    dirtColour: { value: sets.dirt.colour },
    dirtNormal: { value: sets.dirt.normal },
    dirtArm: { value: sets.dirt.arm },
    rockColour: { value: sets.rock.colour },
    rockNormal: { value: sets.rock.normal },
    rockArm: { value: sets.rock.arm },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, maps);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGroundWorld;
        varying vec3 vGroundNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGroundNormal = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGroundWorld;
        varying vec3 vGroundNormal;
        uniform sampler2D turfColour, turfNormal, turfArm;
        uniform sampler2D dirtColour, dirtNormal, dirtArm;
        uniform sampler2D rockColour, rockNormal, rockArm;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + 1.0), f.x), f.y);
        }
        vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(5.0)); return w / (w.x + w.y + w.z); }
        vec4 tri(sampler2D t, vec3 p, vec3 w, float s) {
          return texture2D(t, p.zy * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
        }
        vec3 triNormal(sampler2D t, vec3 p, vec3 n, vec3 w, float s) {
          vec3 nx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0;
          vec3 ny = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
          vec3 nz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
          nx = vec3(nx.xy + n.zy, abs(nx.z) * n.x);
          ny = vec3(ny.xy + n.xz, abs(ny.z) * n.y);
          nz = vec3(nz.xy + n.xy, abs(nz.z) * n.z);
          return normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
        }
        vec3 topNormal(vec3 m, vec3 n) {
          m = m * 2.0 - 1.0;
          m = vec3(m.xy + n.xz, abs(m.z) * n.y);
          return normalize(m.xzy);
        }
        mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }`,
      )
      .replace(
        "#include <map_fragment>",
        `vec3 P = vGroundWorld;
        vec3 N = normalize(vGroundNormal);
        float macro = gNoise(P.xz * 0.035) * 0.6 + gNoise(P.xz * 0.13) * 0.4;
        float bakedAo = vColor.r;
        float dirtW = vColor.g;
        float rockW = vColor.b;

        // Turf: two scales and a rotation, blended by the macro field, so no repeat shows.
        vec2 uvA = P.xz * 0.3;
        vec2 uvB = rot(1.1) * P.xz * 0.083 + 0.37;
        float ab = smoothstep(0.3, 0.7, gNoise(P.xz * 0.09));
        vec3 turf = mix(texture2D(turfColour, uvA).rgb, texture2D(turfColour, uvB).rgb, ab);
        vec3 turfArmV = mix(texture2D(turfArm, uvA).rgb, texture2D(turfArm, uvB).rgb, ab);
        vec3 turfN = topNormal(mix(texture2D(turfNormal, uvA).xyz, texture2D(turfNormal, uvB).xyz, ab), N);
        // Macro colour: sun-dried patches and lusher hollows.
        vec3 dry = vec3(1.12, 1.04, 0.78);
        vec3 lush = vec3(0.86, 1.02, 0.84);
        turf *= mix(lush, dry, smoothstep(0.25, 0.8, macro)) * mix(0.9, 1.06, gNoise(P.xz * 0.6));

        vec2 uvD = rot(0.4) * P.xz * 0.45;
        vec3 dirt = texture2D(dirtColour, uvD).rgb * vec3(1.02, 0.98, 0.92);
        vec3 dirtArmV = texture2D(dirtArm, uvD).rgb;
        vec3 dirtN = topNormal(texture2D(dirtNormal, uvD).xyz, N);

        vec3 W = triW(N);
        vec3 rock = tri(rockColour, P, W, 0.22).rgb;
        vec3 rockArmV = tri(rockArm, P, W, 0.22).rgb;
        vec3 rockN = triNormal(rockNormal, P, N, W, 0.22);

        // Height-aware blends: dirt shows through the turf's thin spots first.
        float turfHeight = dot(turf, vec3(0.33));
        float dirtMask = smoothstep(0.2, 0.65, dirtW * 1.3 - turfHeight * 0.4 + (gNoise(P.xz * 2.3) - 0.5) * 0.35);
        float rockMask = smoothstep(0.25, 0.7, rockW + (macro - 0.5) * 0.3);
        vec3 albedo = mix(turf, dirt, dirtMask);
        vec3 arm = mix(turfArmV, dirtArmV, dirtMask);
        vec3 groundN = normalize(mix(turfN, dirtN, dirtMask));
        albedo = mix(albedo, rock, rockMask);
        arm = mix(arm, rockArmV, rockMask);
        groundN = normalize(mix(groundN, rockN, rockMask));
        float groundRough = arm.g;
        float groundAo = arm.r;
        diffuseColor.rgb = albedo;`,
      )
      .replace("#include <color_fragment>", "")
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = clamp(groundRough, 0.3, 1.0);",
      )
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = 0.0;")
      .replace(
        "#include <normal_fragment_maps>",
        "normal = normalize((viewMatrix * vec4(groundN, 0.0)).xyz);",
      )
      .replace(
        "#include <aomap_fragment>",
        `float ambientOcclusion = bakedAo * mix(1.0, groundAo, 0.8);
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float dotNVao = saturate(dot(geometryNormal, geometryViewDir));
          reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNVao, ambientOcclusion, material.roughness);
        #endif`,
      );
  };
  material.customProgramCacheKey = () => "meadow-ground-v1";
  return material;
}
