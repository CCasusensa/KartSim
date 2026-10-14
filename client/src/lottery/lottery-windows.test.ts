import assert from "node:assert/strict";
import test from "node:test";
import { node, nodeName, type Node } from "../ui/bml-kit";
import { gachaPickerDefinition, gachaStatus, PACK_ROWS, packWindowDefinition } from "./lottery-windows";

const names = (root: Node): string[] => [nodeName(root), ...root.children.flatMap(names)].filter(Boolean);
const attr = (entry: Node, name: string) => entry.attributes.find(item => item.name === name)?.value;
function find(root: Node, name: string): Node | undefined {
  if (nodeName(root) === name) return root;
  for (const child of root.children) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

test("兑换 window: one release row per pack (well, name, contents, price, 兑换), pages only when paged", () => {
  const paged = packWindowDefinition(PACK_ROWS, true);
  const all = names(paged);
  for (let index = 0; index < PACK_ROWS; index++) assert.ok(all.includes(`packRow${index}`));
  assert.equal(all.filter(name => name === "packBuy").length, PACK_ROWS);
  assert.ok(all.includes("prevPage") && all.includes("nextPage") && all.includes("pageText"));
  const dialog = find(paged, "packDialog")!;
  assert.equal(attr(dialog, "frame"), "CaptionDialog");
  assert.equal(attr(dialog, "setCloseButton"), "closeButton");
  assert.equal(attr(find(paged, "packWell")!, "texture"), "img_slot2");
  assert.equal(attr(find(paged, "packList")!, "frame"), "GrayEdit");
  const single = packWindowDefinition(1, false);
  assert.ok(!names(single).includes("prevPage"));
  // The unpaged window is shorter by the page row and the five missing rows.
  const height = (root: Node) => Number(attr(find(root, "packDialog")!, "windowRect")!.split(" ")[3]);
  assert.ok(height(single) < height(paged));
});

test("选择扭蛋 copies the release card into every cell of the grid and sizes the dialog to it", () => {
  const card = node("eventMenuGachaMultiButton", { windowRect: "0 0 254 308", autoLoadImage: "gachaSlot_0" }, [
    node("ImageButton", { name: "gachaButton", autoLoadImage: "gachaSlot_0", leftTopWH: "0 0 250 288" }, [
      node("Label", { name: "itemName" }), node("ItemWindow", { name: "itemPanel" }),
      node("ColorLabel", { name: "itemInfo" }),
    ]),
  ]);
  const dialog = node("Panel", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "eventMenuGachaMultiDialog", leftTopWH: "0 0 820 376", frame: "CaptionDialog",
      setCloseButton: "closeButton" }, [
      node("Window", { name: "bg", leftTopWH: "0 10 780 308", frame: "InputBoxBg2" }),
      node("GridSelectorDivLoad", { name: "itemSelector", windowSize: "760 290" }),
    ]),
  ]);
  const definition = gachaPickerDefinition(dialog, card, 5, 2);
  const all = names(definition);
  assert.equal(all.filter(name => /^gachaCell\d+$/.test(name)).length, 10);
  assert.equal(all.filter(name => name === "gachaButton").length, 10);
  assert.equal(all.filter(name => name === "gachaMark").length, 10);
  const caption = find(definition, "eventMenuGachaMultiDialog")!;
  assert.equal(attr(caption, "leftTopWH"), "0 0 1330 722");
  assert.equal(attr(find(definition, "bg")!, "leftTopWH"), "0 10 1290 616");
  // The renderer has no ItemWindow / ColorLabel: they become painted labels.
  assert.equal(find(definition, "itemPanel")!.name, "Label");
  assert.equal(find(definition, "itemInfo")!.name, "Label");
});

test("a card's tab says whether the gacha can be used, bought or is closed", () => {
  assert.equal(gachaStatus({ open: false, owned: 3 }), "未开放");
  assert.equal(gachaStatus({ open: true, owned: 2 }), "可使用");
  assert.equal(gachaStatus({ open: true, owned: 0 }), "可兑换");
});
