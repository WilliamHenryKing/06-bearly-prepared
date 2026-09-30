// Whether this visitor has had the guided first minute (Opening.tsx) already.

const KEY = "bearly-prepared:hinted";

export function hasSeenHint() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markHintSeen() {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Storage unavailable: the hint simply shows again next time.
  }
}
