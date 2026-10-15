import assert from "node:assert/strict";
import test from "node:test";
import { fitGarageButtonLabel } from "./garage-button-text-layout";

function fixture(label: string, width: number, fontSize: number,
  paddingLeft = 0, scale = 1) {
  const style: Record<string, string> = {};
  let fontWidth = 0.62;
  const element = {
    tagName: "BUTTON", textContent: label, children: [] as object[],
    classList: { contains: (name: string) => name === "garage-native-button" },
    style, offsetWidth: width,
    getBoundingClientRect: () => ({ width: width * scale }),
    ownerDocument: { createRange: () => ({
      selectNodeContents: () => undefined,
      getBoundingClientRect: () => ({ width: textWidth() * scale }),
    }) },
  };
  const textWidth = () => [...element.textContent].reduce((sum, c) =>
    sum + (/[^\u0000-\u007f]/u.test(c) ? 1 : fontWidth), 0) *
    Number.parseFloat(style.fontSize ?? `${fontSize}`);
  const getStyle = () => ({ fontSize: `${fontSize}px`, paddingLeft: `${paddingLeft}px`,
    paddingRight: "0", borderLeftWidth: "0", borderRightWidth: "0", ...style });
  return { element, style, getStyle, textWidth, changeFont: (factor: number) => { fontWidth = factor; },
    fit: () => fitGarageButtonLabel(element as unknown as HTMLElement) };
}

test("Chinese, English and Korean labels fit native tab and action widths without changing hit areas", () => {
  const previous = globalThis.getComputedStyle;
  try {
    for (const scale of [0.6, 1, 2]) {
      for (const [labels, width, font, padding] of [
        [["车辆改装", "Vehicle Tuning", "팩토리"], 124, 16, 35],
        [["恢复原装", "Restore defaults", "기본 상태 복원"], 100, 14, 0],
        [["方向盘", "Steering Wheel", "핸들"], 86, 14, 0],
        [["喷焰", "Boost effects", "부스터 이펙트"], 86, 14, 0],
      ] as const) {
        for (const label of labels) {
          const f = fixture(label, width, font, padding, scale);
          globalThis.getComputedStyle = f.getStyle as unknown as typeof getComputedStyle;
          f.fit();
          assert.equal(f.element.offsetWidth, width);
          assert.equal(f.element.textContent, label);
          assert.equal(f.style.whiteSpace, "nowrap");
          assert.equal(f.style.lineHeight, undefined, "preserve the authored line height");
          assert.ok(f.textWidth() <= width - padding - 4, `${label}: ${f.textWidth()}`);
          assert.ok(Number.parseFloat(f.style.fontSize ?? `${font}`) <= font);
          const first = { ...f.style };
          f.fit();
          assert.deepEqual(f.style, first, "stable layout must not keep mutating the canvas source");
        }
      }
    }
  } finally { globalThis.getComputedStyle = previous; }
});

test("late fonts and changing labels are measured again and can recover the original font size", () => {
  const previous = globalThis.getComputedStyle;
  const f = fixture("Restore defaults", 100, 14);
  globalThis.getComputedStyle = f.getStyle as unknown as typeof getComputedStyle;
  try {
    f.fit();
    const initialSize = Number.parseFloat(f.style.fontSize!);
    f.changeFont(0.8);
    f.fit();
    assert.ok(Number.parseFloat(f.style.fontSize!) < initialSize);
    assert.ok(f.textWidth() <= 96);
    f.element.textContent = "恢复原装";
    f.fit();
    assert.equal(f.style.fontSize, "14px");
  } finally { globalThis.getComputedStyle = previous; }
});

test("image-only controls, cards with nested labels and other elements retain their layout", () => {
  const f = fixture("Vehicle Tuning", 124, 16, 35);
  f.element.tagName = "DIV";
  f.fit();
  assert.deepEqual(f.style, {});
  f.element.tagName = "BUTTON";
  f.element.textContent = "";
  f.fit();
  assert.deepEqual(f.style, {});
  f.element.textContent = "Vehicle Tuning";
  f.element.children = [{}];
  f.fit();
  assert.deepEqual(f.style, {});
});
