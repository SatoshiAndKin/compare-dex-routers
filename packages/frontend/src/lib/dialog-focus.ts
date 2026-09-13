/** Keep keyboard focus inside an open dialog and restore its trigger on close. */
export function dialogFocus(node: HTMLElement, close: () => void) {
  const previous = document.activeElement;
  const overflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const focusable = () =>
    Array.from(
      node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'
      )
    ).filter((element) => !element.closest("[hidden]"));
  (focusable()[0] ?? node).focus();
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = focusable();
    const first = elements[0] ?? node;
    const last = elements.at(-1) ?? node;
    if (!node.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", keydown);
  return {
    update(next: () => void) {
      close = next;
    },
    destroy() {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    },
  };
}
