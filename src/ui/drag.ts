export interface DragHandlers {
  onStart(): void;
  /** Called with the pointer's movement since the drag began. */
  onMove(dx: number, dy: number): void;
  onEnd(): void;
  /** A press that did not move far enough to count as a drag. */
  onClick(): void;
}

const THRESHOLD = 5;

/** Pointer dragging that still lets a plain press act as a click. */
export function makeDraggable(handle: HTMLElement, h: DragHandlers): void {
  let start: { x: number; y: number; id: number } | null = null;
  let dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging && Math.hypot(dx, dy) < THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      h.onStart();
    }
    h.onMove(dx, dy);
  });
  const finish = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    if (dragging) h.onEnd();
    else if (e.type === 'pointerup') h.onClick();
    dragging = false;
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  // Keyboard activation arrives as a click with no pointer press before it.
  handle.addEventListener('click', (e) => {
    if (e.detail === 0) h.onClick();
  });
}
