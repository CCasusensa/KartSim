import { tr } from "../../i18n/locale";
/** 小型 DOM 构造助手。 */

type Child = Node | string | number | false | null | undefined;
type Attributes = Record<string, unknown> & {
  class?: string;
  style?: string;
  title?: string;
  onclick?: (event: MouseEvent) => void;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "class") element.className = String(value);
    else if (key === "style") element.setAttribute("style", String(value));
    else if (key in element && typeof value !== "string") (element as unknown as Record<string, unknown>)[key] = value;
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  append(element, children);
  return element;
}

export function append(element: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
}

export function button(label: string, onclick: () => void, options: { class?: string; title?: string; disabled?: boolean } = {}): HTMLButtonElement {
  return h("button", { class: `k-button ${options.class ?? ""}`, title: options.title, disabled: options.disabled, onclick: () => onclick(), type: "button" }, label);
}

/** 带标签的数字输入：回车或失焦时提交。 */
export function numberField(label: string, value: number, commit: (value: number) => void,
  options: { step?: number; min?: number; max?: number; digits?: number; unit?: string } = {}): HTMLElement {
  const input = h("input", { class: "k-edit", type: "number", step: String(options.step ?? 1),
    min: options.min !== undefined ? String(options.min) : undefined, max: options.max !== undefined ? String(options.max) : undefined });
  const digits = options.digits ?? 2;
  input.value = String(Number(value.toFixed(digits)));
  input.addEventListener("change", () => {
    const next = Number(input.value);
    if (!Number.isFinite(next)) { input.value = String(value); return; }
    let clamped = next;
    if (options.min !== undefined) clamped = Math.max(options.min, clamped);
    if (options.max !== undefined) clamped = Math.min(options.max, clamped);
    commit(clamped);
  });
  input.addEventListener("keydown", event => { if (event.key === "Enter") input.blur(); event.stopPropagation(); });
  return h("label", { class: "ed-field" }, h("span", {}, label), input, options.unit ? h("em", {}, options.unit) : undefined);
}

export function textField(label: string, value: string, commit: (value: string) => void, maxLength = 24): HTMLElement {
  const input = h("input", { class: "k-edit", type: "text", maxLength });
  input.value = value;
  input.addEventListener("change", () => commit(input.value));
  input.addEventListener("keydown", event => { if (event.key === "Enter") input.blur(); event.stopPropagation(); });
  return h("label", { class: "ed-field ed-wide" }, h("span", {}, label), input);
}

export function checkField(label: string, value: boolean, commit: (value: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox" });
  input.checked = value;
  input.addEventListener("change", () => commit(input.checked));
  return h("label", { class: "ed-check" }, input, h("span", {}, label));
}

export function selectField(label: string, value: string, choices: Array<[string, string]>, commit: (value: string) => void): HTMLElement {
  const select = h("select", { class: "k-combo" });
  for (const [key, text] of choices) select.append(h("option", { value: key }, tr(text)));
  select.value = value;
  select.addEventListener("change", () => commit(select.value));
  return h("label", { class: "ed-field ed-wide" }, h("span", {}, label), select);
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "ed-section" }, h("h3", {}, title), ...children);
}

export function clear(element: HTMLElement): void {
  while (element.firstChild) element.firstChild.remove();
}
