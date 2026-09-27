// Arrival loader (D09): the veil in index.html stays until the first frame is drawn.
// A safety reveal after 12 s never leaves a blank screen.
let revealed = false;

export function worldReady() {
  if (revealed || typeof document === "undefined") return;
  revealed = true;
  const veil = document.getElementById("arrival");
  if (!veil) return;
  veil.classList.add("is-done");
  window.setTimeout(() => veil.remove(), 700);
}

if (typeof window !== "undefined") window.setTimeout(worldReady, 12_000);
