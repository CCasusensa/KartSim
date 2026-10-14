import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "@babel/parser";
import {
  deleteGhostFromMenu, exportGhostFromMenu, importSelectedGhostFile,
  isCurrentGhostImport, switchToImportedGhostTrack,
} from "../src/timeattack/ghost-menu-import.ts";
import { GhostMenuPanel, GHOST_MENU_HINT } from "../src/timeattack/ghost-menu-panel.ts";
import { TouchDrivingControls } from "../src/input/touch-driving-controls.ts";

const release = readFileSync(
  new URL("../../recovered/formatted/index.js", import.meta.url), "utf8");
const panelNode = parse(release, { sourceType: "module" }).program.body.find(
  node => node.type === "ClassDeclaration" && node.id.name === "Ly");
assert.ok(panelNode);
const panelSource = release.slice(panelNode.start, panelNode.end);

/**
 * The release panel's DOM buttons are now the SIM menu's TextButtons; the
 * same clicks (by label) must do the same things, and the file input stays.
 */
async function scenario(readable) {
  const events = [];
  let nextId = 0;
  let mode = "native";
  class Element {
    constructor(tag) { this.tag = tag; this.id = ++nextId; }
    attributes = {};
    listeners = new Map();
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    removeEventListener(name) { this.listeners.delete(name); }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { (this.children ??= []).push(...children); }
    click() { events.push(["click", this.tag, this.type]); }
    remove() { events.push(["remove", this.tag]); }
  }
  const labels = {
    native: "原生", "native-smooth": "原生平滑", c1: "C1", c2: "C2",
  };
  const modes = ["native", "native-smooth", "c1", "c2"];
  const nextSamplingMode = current =>
    modes[(modes.indexOf(current) + 1) % modes.length];
  const saveSamplingMode = next => events.push(["save mode", next]);
  const importDependencies = {};
  const OriginalPanel = new Function(
    "qh0", "Xh0", "jh0", "deleteGhostFromMenu", "exportGhostFromMenu",
    "importSelectedGhostFile", "ghostMenuImportDependencies",
    "isCurrentGhostImport", "switchToImportedGhostTrack",
    `${panelSource}; return Ly;`,
  )(labels, nextSamplingMode, saveSamplingMode,
    deleteGhostFromMenu, exportGhostFromMenu, importSelectedGhostFile,
    importDependencies, isCurrentGhostImport, switchToImportedGhostTrack);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true, value: { createElement: tag => new Element(tag) },
  });
  try {
    const root = new Element("root");
    const options = {
      root,
      samplingMode: () => mode,
      onSamplingModeChange: next => { events.push(["mode", next]); mode = next; },
      resetNickname: () => events.push(["reset nickname"]),
      currentGhostKey: () => "test-key",
      deleteGhost: async key => events.push(["delete ghost", key]),
      exportGhost: async key => events.push(["export ghost", key]),
      reportError: message => events.push(["error", message]),
    };
    const panel = readable
      ? new GhostMenuPanel(options, {
        samplingLabels: labels, nextSamplingMode, saveSamplingMode,
        import: importDependencies,
      })
      : new OriginalPanel(options);
    // Label → click, from the menu entries or the release DOM buttons.
    const buttons = () => readable
      ? panel.menuEntries().map(entry => [entry.text, entry.action])
      : [panel.importButton, panel.exportButton, panel.deleteButton,
        panel.samplingModeButton, panel.resetNicknameButton]
        .map(button => [button.textContent, () => button.listeners.get("click")()]);
    const click = async prefix => {
      const [, action] = buttons().find(([text]) => text.startsWith(prefix));
      await action();
    };
    const initial = {
      labels: buttons().map(([text]) => text),
      input: { type: panel.input.type, accept: panel.input.accept, hidden: panel.input.hidden },
      inputMounted: root.children.length === 1 && root.children[0] === panel.panel &&
        panel.panel.children.includes(panel.input),
      listensForFile: panel.input.listeners.has("change"),
    };
    await click("幽灵插值");
    await click("幽灵插值");
    // The release label lagged one mode behind (refreshed before the mode
    // changed); the menu draws the mode in use.
    const sampling = buttons().find(([text]) => text.startsWith("幽灵插值"))[0];
    panel.input.value = "old.ksv";
    await click("导入影子");
    const pickerValue = panel.input.value;
    await click("删除影子");
    await click("导出 KSV");
    await click("重置车手名");
    await Promise.resolve();
    const importCurrent = [panel.isCurrentImport(0), panel.isCurrentImport(1)];
    panel.dispose();
    panel.dispose();
    return {
      events, initial, sampling: readable ? sampling : `幽灵插值：${labels[mode]}`, pickerValue, importCurrent,
      disposed: panel.disposed,
      listensAfterDispose: panel.input.listeners.has("change"),
    };
  } finally {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
}

test("Ghost menu actions, mode labels and disposal match release", async () => {
  assert.deepEqual(await scenario(true), await scenario(false));
});

test("Ghost tools are a SIM menu section with a hidden file input", () => {
  const created = [];
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: tag => {
    const element = { tag, children: [], addEventListener() {}, removeEventListener() {},
      append(...children) { this.children.push(...children); }, remove() { this.removed = true; } };
    created.push(element);
    return element;
  } } });
  try {
    const root = { children: [], append(child) { this.children.push(child); } };
    const panel = new GhostMenuPanel({ root, samplingMode: () => "c1", onSamplingModeChange() {},
      resetNickname() {} }, { samplingLabels: { native: "原生", "native-smooth": "原生平滑", c1: "C1", c2: "C2" },
      nextSamplingMode: mode => mode, saveSamplingMode() {}, import: {} });
    // No visible DOM buttons: only the hidden holder and its file input.
    assert.deepEqual(created.map(element => element.tag), ["div", "input"]);
    assert.equal(panel.panel.hidden, true);
    assert.equal(panel.title, "影子记录");
    assert.equal(panel.hint, GHOST_MENU_HINT);
    assert.deepEqual(panel.menuEntries().map(entry => entry.text),
      ["导入影子(.ksv)", "导出 KSV", "删除影子", "幽灵插值：C1", "重置车手名"]);
    // The SIM menu finds it through its slot.
    assert.deepEqual(TouchDrivingControls.prototype.menuSections.call({ ghostMenuSlot: root }), [panel]);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
});
