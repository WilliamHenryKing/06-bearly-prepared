// Arrival loader (D09): the veil in index.html stays until the first frame is drawn.
// A safety reveal after 30 s never leaves a blank screen. (It was 12 s, but a modest laptop
// can take longer than that to build the valley, and the veil then lifted on a half-built
// scene: the bear floating in grey fog.)
let revealed = false;

export function worldReady() {
  if (revealed || typeof document === "undefined") return;
  revealed = true;
  const veil = document.getElementById("arrival");
  if (!veil) return;
  veil.classList.add("is-done");
  window.setTimeout(() => veil.remove(), 700);
}

if (typeof window !== "undefined") window.setTimeout(worldReady, 30_000);
