/** Focus a readable packing surface after the title glide or replay. */
export function focusPacking() {
  const panel = document.querySelector<HTMLElement>(".pack-panel");
  if (!panel) return;
  panel.focus({ preventScroll: true });
  panel.scrollTop = 0;
}

/** A stable control survives fetching and gives keyboard players an obvious next action. */
export function focusHikeControl() {
  document.querySelector<HTMLElement>(".hike-controls")?.focus({ preventScroll: true });
}
