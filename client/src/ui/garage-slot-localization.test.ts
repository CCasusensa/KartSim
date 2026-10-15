import assert from "node:assert/strict";
import test from "node:test";
import { tr, type GameLocale } from "../i18n/locale";
import { updateGarageVehicleInformation, type GarageVehicleInformationHost,
  type GarageVehicleInformationDependencies } from "./garage-vehicle-information";
import { updateGarageControls, type GarageControlsHost,
  type GarageControlsDependencies } from "./garage-controls";
import { garagePartDisplayName, type GaragePartLabelDependencies } from "./garage-part-presentation";
import type { GaragePart, GaragePartSlot } from "./garage-parts-business";

const labels: Record<GaragePartSlot, string> = {
  engine: "引擎", handle: "方向盘", wheel: "车轮", booster: "加速器",
};
class ElementStub {
  textContent = "";
  title = "";
  className = "";
  disabled = false;
  scrollTop = 0;
  children: ElementStub[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style = { setProperty() {} };
  classList = { toggle() {} };
  onclick?: () => void;
  replaceChildren() { this.children = []; }
  append(...children: ElementStub[]) { this.children.push(...children); }
  querySelector() { return undefined; }
  querySelectorAll() { return []; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}
const element = () => new ElementStub() as unknown as HTMLElement;
const noop = () => {};
function withLocale(locale: GameLocale, run: () => void): void {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  globalThis.document = { createElement: () => new ElementStub() } as unknown as Document;
  try { run(); } finally {
    globalThis.document = previousDocument;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("equipped slot text, tooltip and aria use the active language while slot keys stay canonical", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    const controls = new Map(Object.keys(labels).map(slot => [slot, new ElementStub()]));
    const visitedSlots: string[] = [];
    const host = {
      selected: { title: "My Kart", engineGrade: 9 }, pageMode: "parts", slot: "engine",
      assets: { parts: [], nodes: new Map() },
      slotControls: controls, updateVehicleFunctions: noop, icon: () => undefined,
      partVisual: noop, rect: (path: string) => path, place: noop,
    } as unknown as GarageVehicleInformationHost;
    const dependencies = {
      vehicleFamily: () => "xun", resolvePart: (_vehicle: unknown, _equipment: unknown, slot: string) => {
        visitedSlots.push(slot); return { family: "xun" };
      },
      slotLocked: () => false, xunPartLevel: () => 1,
      partPresentation: (label: string | undefined) => ({ value: label! }),
      slotLabel: (slot: string) => labels[slot as GaragePartSlot],
      uniqueLevel: () => 0, isMaxLevel: () => false,
      slotNodeNames: labels,
    } as unknown as GarageVehicleInformationDependencies;
    updateGarageVehicleInformation(host, {}, {}, { kind: "xun", slotSize: 50, equippedRoot: "parts" }, false, dependencies);
    for (const [slot, button] of controls) {
      const localized = tr(labels[slot as GaragePartSlot]);
      assert.equal(button.title, `${localized} · Lv.1`);
      if (locale !== "zh-CN") assert.doesNotMatch(button.title, /[\p{Script=Han}]/u);
      assert.equal(button.attributes.get("aria-label"), button.title);
      assert.equal(button.children[0]?.textContent, localized);
    }
    assert.deepEqual(visitedSlots, ["engine", "handle", "wheel", "booster"]);
  });
});

test("part preview and equip descriptions translate slot labels without changing selected parts", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    for (const slot of Object.keys(labels) as GaragePartSlot[]) {
      const part: GaragePart = { family: "v1", slot, itemId: 7001, value: 10, grade: 2 };
      const inventory = new ElementStub();
      const actions: unknown[] = [];
      const buttons: ElementStub[] = [];
      const button = (label: string, action: () => void) => {
        const node = new ElementStub(); node.textContent = label; node.onclick = action;
        buttons.push(node); return node as unknown as HTMLButtonElement;
      };
      const host: Partial<GarageControlsHost> = {
        selected: { itemId: 123, title: "My Kart", path: "kart.1s", engineGrade: 8 },
        pageMode: "parts", slot, coatingMode: false, cosmeticBusy: false,
        assets: { parts: [part], strings: new Map(), imageUrls: new Map() },
        element: element(), controls: element(), inventory: inventory as unknown as HTMLElement,
        partTitle: element(), removePart: element() as HTMLButtonElement,
        progressionPanel: { element: element(), update: noop, updateRadar: noop },
        modelCache: { clear: noop }, modelTargets: [], previewParts: new Map(),
        setVehicleInfoNodesMounted: noop, setPartsOnlyNodesMounted: noop,
        setUpgradeStatusMounted: noop, updateVehicleHeading: noop,
        updateVehicleInformation: noop, updateCosmeticEquippedSlots: noop,
        updatePageVisibility: noop, updateCards: noop,
        serial: () => 0, base: () => ({}), place: noop, moveToTransformPreviewRoot: noop,
        button, nativeButton: (_path, label, action) => button(label, action),
        partLabel: () => "Preserved Part 10", icon: () => undefined, partVisual: noop, skin: noop,
        setPartPreview: value => { actions.push(value); }, requestEquip: value => { actions.push(value); },
        selectSlot: value => { actions.push(value); },
      };
      const dependencies: Partial<GarageControlsDependencies> = {
        showVehicleInformation: () => true, progressionFamily: () => "v1",
        canCustomize: () => true, progressionSupport: () => "classic",
        expectedProgressionKind: () => "classic", currentEquipment: () => ({}),
        vehicleFamily: () => "v1", layoutForGrade: () => ({ kind: "v1", partsTab: "parts", cosmeticTabs: [] }),
        slots: [slot], slotNodes: labels, slotLabel: value => labels[value],
        partsForSlot: () => [part], cardLayout: () => ({ width: 100, height: 100, stepX: 100, stepY: 100,
          iconWidth: 50, iconHeight: 50, iconAdjustY: 0, texture: "card",
          titleRect: { x: 0, y: 0, width: 100, height: 20 } }),
        inventoryRect: () => ({}), quality: () => 2, cardTexture: () => "card",
        samePart: () => false, equippedPart: () => undefined,
        slotLocked: () => false, canEquip: () => true, bindPreview: noop,
      };
      updateGarageControls(host as GarageControlsHost, dependencies as GarageControlsDependencies);
      const preview = buttons.find(node => node.className === "garage-part-preview");
      const equip = buttons.find(node => node.className === "garage-equip-label");
      assert.ok(preview && equip, `card renders for ${locale}/${slot}`);
      assert.equal(preview.attributes.get("aria-label"),
        tr("预览 {0} {1}", { "0": "Preserved Part 10", "1": tr(labels[slot]) }));
      assert.equal(equip.attributes.get("aria-label"), `${tr("装备")} Preserved Part 10 ${tr(labels[slot])}`);
      assert.equal(buttons[0]!.textContent, tr(labels[slot]));
      if (locale !== "zh-CN") {
        assert.doesNotMatch(preview.attributes.get("aria-label")!, /[\p{Script=Han}]/u);
        assert.doesNotMatch(equip.attributes.get("aria-label")!, /[\p{Script=Han}]/u);
      }
      preview.onclick?.(); equip.onclick?.(); buttons[0]!.onclick?.();
      assert.deepEqual(actions, [part, part, slot]);
    }
  });
});

test("missing native strings use translated part slots but preserve legacy names", () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) withLocale(locale, () => {
    const dependencies: GaragePartLabelDependencies = {
      slotLabel: slot => labels[slot as GaragePartSlot], slotKey: { engine: "engine" },
      localize: (_strings, _key, fallback) => fallback,
      engineName: () => "V1", gradeName: () => "", defaultParts: () => [],
    };
    const part = { family: "v1", slot: "engine", grade: 2, value: 10, itemId: 123 };
    assert.equal(garagePartDisplayName(part, {}, [part], dependencies), `V1 ${tr("引擎")} 1`);
    assert.equal(garagePartDisplayName({ ...part, family: "legacy" }, {}, [], dependencies), `${tr("引擎")} 123`);
    assert.equal(garagePartDisplayName({ ...part, family: "legacy", legacyTitle: "Custom Engine" }, {}, [], dependencies), "Custom Engine");
  });
});
