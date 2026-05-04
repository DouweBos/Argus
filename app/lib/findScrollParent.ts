/**
 * Walk up the DOM to find the nearest ancestor that scrolls vertically. Used
 * to root an IntersectionObserver on the chat's scrolling container without
 * threading a ref through every caller.
 */
export function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}
