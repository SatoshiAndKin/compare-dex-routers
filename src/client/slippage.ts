/**
 * Slippage controls module.
 *
 * Manages:
 * - Slippage preset buttons (3, 10, 50, 100, 300 bps)
 * - Custom slippage input field
 * - Active state highlighting on preset buttons
 * - Reading current slippage value
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlippageElements {
  slippageInput: HTMLInputElement;
  slippagePresetBtns: NodeListOf<HTMLElement>;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let els: SlippageElements | null = null;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Update active state on slippage preset buttons.
 * Highlights the button whose data-bps value matches the given value.
 */
export function updateSlippagePresetActive(value: string | number): void {
  if (!els) return;
  const bpsValue = String(value || "").trim();
  els.slippagePresetBtns.forEach((btn) => {
    const btnBps = (btn as HTMLElement).dataset.bps;
    btn.classList.toggle("active", btnBps === bpsValue);
  });
}

/**
 * Get the current slippage value in basis points from the input field.
 */
export function getSlippageBps(): string {
  if (!els) return "50";
  return els.slippageInput.value;
}

/**
 * Set the slippage value and update preset active state.
 */
export function setSlippageBps(value: string): void {
  if (!els) return;
  els.slippageInput.value = value;
  updateSlippagePresetActive(value);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize slippage controls.
 * Wires up click handlers on preset buttons and input change handler.
 */
export function initSlippage(elements: SlippageElements): void {
  els = elements;

  const { slippageInput, slippagePresetBtns } = elements;

  // Slippage preset button click handler
  slippagePresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const bps = (btn as HTMLElement).dataset.bps;
      if (bps) {
        slippageInput.value = bps;
        updateSlippagePresetActive(bps);
      }
    });
  });

  // On custom input, update preset active state
  slippageInput.addEventListener("input", () => {
    updateSlippagePresetActive(slippageInput.value);
  });
}
