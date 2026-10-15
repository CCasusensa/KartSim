/** Fit authored button labels before the Garage DOM is rasterized to its canvas. */

const authoredFontSizes = new WeakMap<HTMLElement, number>();

const pixels = (value: string): number => Number.parseFloat(value) || 0;

/**
 * Measure the actual DOM font, including fallback fonts and kerning. The native
 * image and hit rectangle stay unchanged; only a label that does not fit shrinks.
 * Nested cards and image-only buttons are deliberately excluded.
 */
export function fitGarageButtonLabel(element: HTMLElement): void {
  if (element.tagName !== "BUTTON" ||
      !element.classList.contains("garage-native-button") ||
      element.children.length || !element.textContent?.trim()) return;

  let style = getComputedStyle(element);
  const currentSize = pixels(style.fontSize);
  const bounds = element.getBoundingClientRect();
  const layoutWidth = element.offsetWidth;
  if (!currentSize || !layoutWidth || !bounds.width) return;
  const maxSize = authoredFontSizes.get(element) ?? currentSize;
  authoredFontSizes.set(element, maxSize);

  // These are real text labels in the original blank button textures, not text
  // placed over translated artwork. Keep every label on one centered line.
  if (element.style.whiteSpace !== "nowrap") element.style.whiteSpace = "nowrap";
  if (element.style.overflow !== "hidden") element.style.overflow = "hidden";
  style = getComputedStyle(element);
  const horizontalInset = pixels(style.paddingLeft) + pixels(style.paddingRight) +
    pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);
  const available = Math.max(0, layoutWidth - horizontalInset - 4) * bounds.width / layoutWidth;
  if (!available) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const measured = range.getBoundingClientRect().width;
  if (!measured) return;
  const size = Math.min(maxSize, Math.floor(currentSize * available / measured * 10) / 10);
  if (size > 0 && Math.abs(currentSize - size) >= 0.05)
    element.style.fontSize = `${size}px`;
}
