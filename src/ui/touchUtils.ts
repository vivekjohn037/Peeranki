/**
 * touchUtils.ts
 * Mobile touch helper ensuring instantaneous tap response (zero delay),
 * preventing synthetic click duplicates, and ensuring reliable touch targets.
 */

export function addFastTapListener<T extends HTMLElement>(
  element: T,
  handler: (e: Event) => void,
): void {
  let touchHandled = false;

  element.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      // Only process primary button or touch pointer
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      touchHandled = true;
      handler(e);
    },
    { passive: false },
  );

  element.addEventListener('click', (e: MouseEvent) => {
    if (touchHandled) {
      touchHandled = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handler(e);
  });
}

/** Require a new press on newly shown controls; reject clicks left over from the board. */
export function addFreshTapListener(element: HTMLButtonElement, handler: () => void): void {
  let pressedHere = false;
  element.addEventListener('pointerdown', (event) => {
    pressedHere = !element.disabled && event.isPrimary !== false && event.button === 0;
  });
  element.addEventListener('pointercancel', () => { pressedHere = false; });
  element.addEventListener('click', (event) => {
    const intentional = pressedHere || event.detail === 0; // Keyboard / assistive activation.
    pressedHere = false;
    event.preventDefault();
    event.stopPropagation();
    if (!element.disabled && intentional) handler();
  });
}
