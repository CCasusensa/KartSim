import { tr } from "../../i18n/locale";
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
  name.value = tr("我的赛道");
  name.addEventListener("keydown", event => event.stopPropagation());
  const presetCards = h("div", { class: "ed-cards" });
  const shapeCards = h("div", { class: "ed-cards" });
  // 选中：原版的选中底和青色选中圈
  const select = (container: HTMLElement, card: HTMLElement) => {
    for (const other of container.children) other.classList.remove("k-selected", "k-ring");
    card.classList.add("k-selected", "k-ring");
  };
  for (const item of data.presets) {
    const sky = data.skies.find(entry => entry.id === item.sky);
    const card = h("button", { class: `k-row ed-card ${item === preset ? "k-selected k-ring" : ""}`, type: "button" },
      h("div", { class: "ed-sprite", style: sky ? spriteStyle(data, sheets, sky.slot, 88) : "" }),
      h("span", { class: "ed-label" }, tr(themeTitle(item.theme))));
    card.addEventListener("click", () => { preset = item; select(presetCards, card); });
    presetCards.append(card);
  }
  for (const item of [...TRACK_TEMPLATES, undefined]) {
    const image = item ? drawTemplate(item, 88) : h("div", { style: "display:flex;align-items:center;justify-content:center;font-size:40px;color:#2a5fb0" }, "✎");
    image.classList.add("ed-sprite");
    const card = h("button", { class: `k-row ed-card ${item === template ? "k-selected k-ring" : ""}`, type: "button", title: item ? tr(item.description) : tr("空白地图，自己画路") },
      image, h("span", { class: "ed-label" }, item ? tr(item.title) : tr("自己画")));
    card.addEventListener("click", () => { template = item; select(shapeCards, card); });
    shapeCards.append(card);
  }
  const content = h("div", { class: "ed-wizard" },
    h("div", { class: "ed-row-fields" }, h("label", { class: "ed-field" }, h("span", {}, tr("地图名")), name),
      checkField(tr("路边自动种树、摆路灯"), decorate, on => { decorate = on; }),
      checkField(tr("放道具箱（能开道具赛）"), items, on => { items = on; })),
    h("h4", {}, tr("① 选一个主题（天空、路面、护栏、地面和音乐一起换）")), presetCards,
    h("h4", {}, tr("② 选赛道形状（之后可以拖控制点改）")), shapeCards);
  const create = () => {
    const design = wizardDesign(data, { name: name.value.trim() || tr("我的赛道"), preset, template, decorate, items });
    app.loadNewDesign(design);
    app.state.dirty = true;
    app.state.emit("meta");
    app.scheduleAutosave();
    app.say(template
      ? tr("「{value}」做好了！在下面素材栏挑建筑、树木摆上去，或者直接“开车试玩”", { value: String(design.name) })
      : tr("空白地图：在素材栏“赛道”里选个形状，或者用左边的“画赛道”自己画"), 10000);
  };
  const dialog = modal(options.firstRun ? tr("欢迎来到地图工坊") : tr("新建地图"), content,
    options.firstRun ? [[tr("开始做地图"), create], [tr("先随便看看"), () => app.resetDesign()]] : [[tr("创建"), create], [tr("取消"), () => undefined]]);
  dialog.body.parentElement?.classList.add("ed-wide-dialog");
  dialog.body.style.whiteSpace = "normal";
}
