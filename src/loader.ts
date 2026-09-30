// Only a successful scene render can lift the veil. Slow and failed startups keep a
// readable status and recovery action instead of exposing an unfinished valley.
let removal = 0;
let slow = 0;

function status(message: string) {
  const veil = document.getElementById("arrival");
  if (!veil) return;
  const label = veil.querySelector(".label");
  if (label) label.textContent = message;
  veil.querySelector(".sr-only")?.remove();
  if (!veil.querySelector("button")) {
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload";
    reload.style.cssText =
      "min-height:44px;padding:10px 20px;border:2px solid #9a6438;border-radius:12px;background:#f6eedb;color:#3a2a1e;font:700 16px system-ui;cursor:pointer";
    reload.onclick = () => window.location.reload();
    veil.append(reload);
  }
}

export function worldReady() {
  if (typeof document === "undefined") return;
  clearTimeout(slow);
  const veil = document.getElementById("arrival");
  if (!veil || veil.classList.contains("is-done")) return;
  veil.classList.add("is-done");
  removal = window.setTimeout(() => veil.remove(), 700);
}

export function worldFailed() {
  clearTimeout(slow);
  clearTimeout(removal);
  let veil = document.getElementById("arrival");
  if (!veil) {
    veil = document.createElement("div");
    veil.id = "arrival";
    veil.setAttribute("role", "alert");
    const label = document.createElement("span");
    label.className = "label";
    veil.append(label);
    document.body.append(veil);
  }
  veil.classList.remove("is-done");
  veil.querySelector(".bar")?.remove();
  status("The valley could not load");
  veil.querySelector("button")?.focus({ preventScroll: true });
}

if (typeof window !== "undefined") {
  slow = window.setTimeout(() => status("Still preparing the valley"), 30_000);
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearTimeout(slow);
    clearTimeout(removal);
  });
