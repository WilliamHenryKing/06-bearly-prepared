// Quality tiers (after ODD TIDE's), so the hike runs smoothly on a modest laptop and at full
// fidelity on a capable GPU. The tier is guessed at startup from the GPU and the device
// (overridable with ?quality=low|medium|high, and per setting with ?ao=0|1, ?msaa=0|2|4,
// ?shadow=1024 and ?budget=<pixels>); in play, Stage.degrade sheds cost further whenever frames
// run long: ambient occlusion, then fur and grass density, multisampling and resolution.

export type Quality = "high" | "medium" | "low";

export interface QualityTier {
  quality: Quality;
  /** Drawing-buffer pixels the scene may use. */
  pixelBudget: number;
  maxPixelRatio: number;
  /** Multisampling of the HDR target (0 = off; SMAA still smooths edges). */
  msaa: number;
  /** Ground-truth ambient occlusion (a second geometry pass and a denoise). */
  ao: boolean;
  /** The sun's shadow map, per side. */
  shadow: number;
}

export const TIERS: Record<Quality, Omit<QualityTier, "quality">> = {
  // As authored: full density up to about 2560 × 1440.
  high: { pixelBudget: 3.7e6, maxPixelRatio: 2, msaa: 4, ao: true, shadow: 2048 },
  // Integrated graphics: 1080p without the AO pass or multisampling.
  medium: { pixelBudget: 2.1e6, maxPixelRatio: 1.5, msaa: 0, ao: false, shadow: 2048 },
  // Phones and software rendering.
  low: { pixelBudget: 1.2e6, maxPixelRatio: 2, msaa: 0, ao: false, shadow: 1024 },
};

const opened = (() => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
})();

/** A first guess from the GPU's name and the device; Stage.degrade corrects it in play. */
export function detectQuality(mobile: boolean): Quality {
  const forced = opened.get("quality");
  if (forced === "high" || forced === "medium" || forced === "low") return forced;
  if (mobile) return "low";
  let gpu = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(
        ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      );
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    return "low";
  }
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return "low";
  if (/nvidia|geforce|rtx|gtx|radeon (rx|pro)|amd radeon rx|apple m[2-9]/i.test(gpu)) return "high";
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|vega|apple m1/i.test(gpu)) return "medium";
  return "medium";
}

/** The tier's settings, with any single setting forced from the URL. */
export function tierSettings(quality: Quality): QualityTier {
  const t: QualityTier = { quality, ...TIERS[quality] };
  const ao = opened.get("ao");
  if (ao === "0" || ao === "1") t.ao = ao === "1";
  const msaa = Number(opened.get("msaa"));
  if (opened.has("msaa") && [0, 2, 4, 8].includes(msaa)) t.msaa = msaa;
  const shadow = Number(opened.get("shadow"));
  if (opened.has("shadow") && [512, 1024, 2048, 4096].includes(shadow)) t.shadow = shadow;
  const budget = Number(opened.get("budget"));
  if (opened.has("budget") && budget >= 2e5 && budget <= 1e7) t.pixelBudget = budget;
  return t;
}
