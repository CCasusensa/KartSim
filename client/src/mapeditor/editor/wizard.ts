/**
 * 新建向导：起个名字，选一个主题套装和一种赛道形状，勾上“路边自动装饰”
 * 和“放道具箱”，一步得到一张能直接试跑的地图。
 */
import { MAP_LIMITS } from "../design";
import { spriteStyle, themeTitle, type ThemePreset } from "../catalog";
import { wizardDesign } from "../decorate";
import { TRACK_TEMPLATES, type TrackTemplate } from "../templates";
import type { EditorApp } from "./app";
import { modal } from "./actions";
import { checkField, h } from "./dom";
import { drawTemplate } from "./dock";

export function openNewMapWizard(app: EditorApp, options: { firstRun?: boolean } = {}): void {
  const data = app.dock.catalog();
  if (!data) { app.resetDesign(); return; }
  let preset: ThemePreset | undefined = data.presets.find(item => item.theme === "village") ?? data.presets[0];
  let template: TrackTemplate | undefined = TRACK_TEMPLATES[0];
  let decorate = true, items = true;
  const sheets = app.dock.sheets();
  const name = h("input", { class: "k-edit", type: "text", maxLength: MAP_LIMITS.nameLength });
  name.value = "我的赛道";
  name.addEventListener("keydown", event => event.stopPropagation());
  const presetCards = h("div", { class: "ed-cards" });
  const shapeCards = h("div", { class: "ed-cards" });
  const select = (container: HTMLElement, card: HTMLElement) => {
    for (const other of container.children) other.classList.remove("k-selected");
    card.classList.add("k-selected");
  };
  for (const item of data.presets) {
    const sky = data.skies.find(entry => entry.id === item.sky);
    const card = h("button", { class: `k-row ed-card ${item === preset ? "k-selected" : ""}`, type: "button" },
      h("div", { class: "ed-sprite", style: sky ? spriteStyle(data, sheets, sky.slot, 88) : "" }),
      h("span", { class: "ed-label" }, themeTitle(item.theme)));
    card.addEventListener("click", () => { preset = item; select(presetCards, card); });
    presetCards.append(card);
  }
  for (const item of [...TRACK_TEMPLATES, undefined]) {
    const image = item ? drawTemplate(item, 88) : h("div", { style: "display:flex;align-items:center;justify-content:center;font-size:40px;color:#2a5fb0" }, "✎");
    image.classList.add("ed-sprite");
    const card = h("button", { class: `k-row ed-card ${item === template ? "k-selected" : ""}`, type: "button", title: item?.description ?? "空白地图，自己画路" },
      image, h("span", { class: "ed-label" }, item?.title ?? "自己画"));
    card.addEventListener("click", () => { template = item; select(shapeCards, card); });
    shapeCards.append(card);
  }
  const content = h("div", { class: "ed-wizard" },
    h("div", { class: "ed-row-fields" }, h("label", { class: "ed-field" }, h("span", {}, "地图名"), name),
      checkField("路边自动种树、摆路灯", decorate, on => { decorate = on; }),
      checkField("放道具箱（能开道具赛）", items, on => { items = on; })),
    h("h4", {}, "① 选一个主题（天空、路面、护栏、地面和音乐一起换）"), presetCards,
    h("h4", {}, "② 选赛道形状（之后可以拖控制点改）"), shapeCards);
  const create = () => {
    const design = wizardDesign(data, { name: name.value.trim() || "我的赛道", preset, template, decorate, items });
    app.loadNewDesign(design);
    app.state.dirty = true;
    app.state.emit("meta");
    app.say(template
      ? `「${design.name}」做好了！在底部素材栏挑建筑、树木摆上去，或者直接点“试跑”。`
      : "空白地图：在素材栏“赛道”里选形状，或者点“画路”自己画。", 10000);
  };
  const dialog = modal(options.firstRun ? "欢迎来到地图工坊" : "新建地图", content,
    options.firstRun ? [["开始做地图", create], ["先随便看看", () => app.resetDesign()]] : [["创建", create], ["取消", () => undefined]]);
  dialog.body.parentElement?.classList.add("ed-wide-dialog");
  dialog.body.style.whiteSpace = "normal";
}
