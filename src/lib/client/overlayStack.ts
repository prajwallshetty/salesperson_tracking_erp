/**
 * Open sheets/drawers register a close callback so the Android back button closes the topmost
 * one instead of leaving the page (web: harmless, nothing listens).
 */
const stack: Array<() => void> = [];

export function pushOverlay(close: () => void): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function hasOverlay(): boolean {
  return stack.length > 0;
}

/** Closes the topmost overlay; returns false when none is open. */
export function closeTopOverlay(): boolean {
  const close = stack[stack.length - 1];
  if (!close) return false;
  close();
  return true;
}
