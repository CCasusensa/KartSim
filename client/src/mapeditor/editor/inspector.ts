/**
 * 简单模式的右侧属性：只放常用的大按钮（转一转、放大缩小、升高降低、
 * 换路面、路宽、护栏），精确数值收在“更多设置”里（用高级模式的面板）。
 */
import { MAP_LIMITS, defaultGround, itemBoxCount, validateDesign, type MapDesign, type PieceDesign, type RoadDesign } from "../design";
import { textureLabel, themeTitle } from "../catalog";
import { sampleRoad } from "../road-geometry";
import { THEME_TITLES } from "../source-tracks";
import type { EditorApp } from "./app";
import { button, checkField, clear, h, numberField, section, selectField, textField } from "./dom";
import { renderMap, renderPieces, renderRoad } from "./panels";

/** 折叠的“更多设置”，记住展开状态。 */
const openDetails = new Set<string>();
function more(key: string, title: string, fill: (body: HTMLElement) => void): HTMLElement {
  const body = h("div");
  const details = h("details", { class: "ed-more" }, h("summary", {}, title), body);
  if (openDetails.has(key)) { details.open = true; fill(body); }
  details.addEventListener("toggle", () => {
    if (details.open) { openDetails.add(key); if (!body.firstChild) fill(body); } else openDetails.delete(key);
  });
  return details;
}

export function renderInspector(app: EditorApp): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement && app.right.contains(focused) && focused.type !== "checkbox") return;
  const scroll = app.right.querySelector(".ed-scroll")?.scrollTop ?? 0;
  clear(app.right);
  app.right.append(h("div", { class: "k-caption" }, "属性"));
  const body = h("div", { class: "ed-scroll" });
  app.right.append(body);
  const tool = app.tool;
  const selection = app.state.selection;
  if (app.mode === "draw") renderDrawing(app, body);
  else if (tool.kind === "place") renderPlacing(app, body);
  else if (tool.kind === "bulldoze") body.append(section("推土机", h("div", { class: "ed-note" }, "点一下摆件就推掉，按住拖动连片推。推错了按 Ctrl+Z 撤销。"),
    button("结束（Esc）", () => app.setTool({ kind: "select" }))));
  else if (tool.kind === "items") body.append(section("放道具箱", h("div", { class: "ed-note" }, "在道路上点一下，就在那里横着放一排 4 个道具箱。"),
    button("结束（Esc）", () => app.setTool({ kind: "select" }))));
  else if (selection?.kind === "pieces") renderPieceButtons(app, body, app.state.selectedPieces());
  else if (selection?.kind === "road") {
    const road = app.state.road(selection.id);
    if (road) renderRoadButtons(app, body, road, selection.point);
  } else renderMapSimple(app, body);
  requestAnimationFrame(() => { body.scrollTop = scroll; });
}

function renderDrawing(app: EditorApp, body: HTMLElement): void {
  const road = app.state.selectedRoad();
  body.append(section("画路",
    h("div", { class: "ed-note" }, "在地图上依次点击放控制点（点在已有的路上会接着它的高度）。",
      h("br"), road && road.points.length >= 3 ? "点回绿色的第一个点，路就闭合成环。" : "至少放 3 个点才能闭合成环。",
      h("br"), "双击、Enter 或 Esc 结束。"),
    h("div", { class: "ed-note" }, `已放 ${road?.points.length ?? 0} 个点`),
    h("div", { class: "ed-grid-buttons ed-two" },
      button("撤销上一个点", () => app.state.undo(), { disabled: !road?.points.length }),
      button("结束画路", () => app.finishDraw(), { class: "ed-primary" }))));
}

function renderPlacing(app: EditorApp, body: HTMLElement): void {
  const tool = app.tool;
  if (tool.kind !== "place") return;
  const piece = tool.piece;
  body.append(section("正在放置",
    h("div", { class: "ed-pieceinfo" }, app.dock.sprite(piece.slot, 64),
      h("div", {}, h("div", { class: "ed-name" }, piece.label), h("div", { class: "ed-note" }, themeTitle(piece.theme)))),
    h("div", { class: "ed-note" }, "在地图上点击放置。树、花、石头、围栏、路灯可以按住拖动连续摆放。"),
    h("div", { class: "ed-note" }, `朝向 ${Math.round(app.tools.yaw)}°　大小 ${Math.round(app.tools.scale * 100)}%`),
    h("div", { class: "ed-grid-buttons" },
      button("⟲ 左转 Q", () => { app.tools.rotateGhost(15); app.queueRender(); }),
      button("⟳ 右转 E", () => { app.tools.rotateGhost(-15); app.queueRender(); }),
      button("转 90°", () => { app.tools.rotateGhost(90); app.queueRender(); }),
      button("放大 ]", () => { app.tools.scaleGhost(1.15); app.queueRender(); }),
      button("缩小 [", () => { app.tools.scaleGhost(1 / 1.15); app.queueRender(); }),
      button("原样", () => { app.tools.scale = 1; app.tools.yaw = 0; app.tools.rotateGhost(0); app.queueRender(); })),
    button("结束放置（Esc / 右键）", () => app.setTool({ kind: "select" }))));
}

function renderPieceButtons(app: EditorApp, body: HTMLElement, pieces: PieceDesign[]): void {
  if (!pieces.length) return;
  const first = pieces[0]!;
  const catalog = app.dock.pieceFor(first.track, first.path);
  const title = pieces.length === 1 ? first.label : `已选 ${pieces.length} 个摆件`;
  body.append(section("摆件",
    h("div", { class: "ed-pieceinfo" }, catalog ? app.dock.sprite(catalog.slot, 64) : undefined,
      h("div", {}, h("div", { class: "ed-name" }, title),
        h("div", { class: "ed-note" }, pieces.length === 1 ? `朝向 ${Math.round(first.rotation[0])}°　大小 ${Math.round(first.scale[0] * 100)}%` : "一起移动、旋转"))),
    h("div", { class: "ed-note" }, "按住摆件拖动可以挪位置。"),
    h("div", { class: "ed-grid-buttons" },
      button("⟲ 左转 Q", () => app.rotateSelection(15)),
      button("⟳ 右转 E", () => app.rotateSelection(-15)),
      button("转 90°", () => app.rotateSelection(90)),
      button("放大 ]", () => app.scaleSelection(1.15)),
      button("缩小 [", () => app.scaleSelection(1 / 1.15)),
      button("原始大小", () => app.scaleSelection(0)),
      button("升高 1 米", () => app.raiseSelection(1)),
      button("降低 1 米", () => app.raiseSelection(-1)),
      button("贴地", () => app.dropToGround(), { title: "落到正下方的路面或地面上" }),
      button("复制", () => app.duplicateSelection(), { title: "Ctrl+D" }),
      button("聚焦", () => app.focusSelection(), { title: "F" }),
      button("删除", () => app.deleteSelection(), { class: "ed-primary", title: "Delete" })),
    catalog ? button(`再放一些「${catalog.label}」`, () => app.setTool({ kind: "place", piece: catalog })) : undefined,
    more("piece-fields", "精确数值", fields => renderPieces(app, fields, app.state.selectedPieces()))));
}

const WIDTHS: Array<[string, number]> = [["窄", 14], ["标准", 22], ["宽", 30], ["超宽", 42]];

function renderRoadButtons(app: EditorApp, body: HTMLElement, road: RoadDesign, point: number | undefined): void {
  const commit = (change: (road: RoadDesign, design: MapDesign) => void) =>
    app.state.commit(design => change(design.roads.find(x => x.id === road.id)!, design));
  const sample = sampleRoad(road, 2);
  const surface = app.dock.textureFor(road.surface.track, road.surface.name);
  const wallTexture = road.walls.left?.texture ?? road.walls.right?.texture;
  const wall = wallTexture ? app.dock.textureFor(wallTexture.track, wallTexture.name) : undefined;
  const swatch = (label: string, texture: typeof surface, fallback: string, open: () => void) => h("div", { class: "ed-swatch" },
    texture ? app.dock.sprite(texture.slot, 40) : h("div", { class: "ed-sprite" }),
    h("span", { class: "ed-name" }, `${label}：${texture ? textureLabel(texture) : fallback}`),
    button("换…", open, { class: "ed-small" }));
  const sides = road.walls.left && road.walls.right ? "both" : road.walls.left ? "left" : road.walls.right ? "right" : "none";
  const setWalls = (value: "both" | "left" | "right" | "none") => commit(r => {
    const template = r.walls.left ?? r.walls.right ?? { texture: structuredClone(app.defaultWall()), height: 1.2, visible: true };
    r.walls.left = value === "both" || value === "left" ? r.walls.left ?? structuredClone(template) : null;
    r.walls.right = value === "both" || value === "right" ? r.walls.right ?? structuredClone(template) : null;
  });
  body.append(section(road.route ? "比赛路线" : "道路",
    h("div", { class: "ed-note" }, `${road.points.length} 个控制点，长 ${sample.total.toFixed(0)} 米${road.route ? `，${app.state.design.laps} 圈` : ""}${
      road.route && !road.closed ? "（还没闭合）" : ""}`),
    h("div", { class: "ed-note" }, "拖白色圆点改形状；点圆点后可以升高、降低。"),
    swatch("路面", surface, road.surface.name, () => app.dock.open("surface")),
    h("div", { class: "ed-note" }, `路宽 ${road.width} 米`),
    h("div", { class: "ed-seg" }, ...WIDTHS.map(([label, width]) =>
      button(label, () => commit(r => { r.width = width; }), { class: road.width === width ? "k-on" : "" }))),
    h("div", { class: "ed-note" }, "护栏"),
    h("div", { class: "ed-seg" },
      button("两侧", () => setWalls("both"), { class: sides === "both" ? "k-on" : "" }),
      button("左边", () => setWalls("left"), { class: sides === "left" ? "k-on" : "" }),
      button("右边", () => setWalls("right"), { class: sides === "right" ? "k-on" : "" }),
      button("不要", () => setWalls("none"), { class: sides === "none" ? "k-on" : "" })),
    sides !== "none" ? swatch("样式", wall, wallTexture?.name ?? "", () => app.dock.open("wall")) : undefined,
    h("div", { class: "ed-grid-buttons" },
      button("继续画路", () => app.startDraw()),
      button("反转方向", () => commit(r => { r.points.reverse(); }), { title: "比赛方向反过来" }),
      button("删除道路", () => { app.state.select({ kind: "road", id: road.id }); app.deleteSelection(); }, { class: "ed-primary" }))));
  if (point !== undefined && road.points[point]) {
    const p = road.points[point]!;
    const setPoint = (change: (point: RoadDesign["points"][number]) => void) => commit(r => change(r.points[point]!));
    body.append(section(`控制点 ${point + 1}`,
      h("div", { class: "ed-note" }, `高度 ${p.z.toFixed(1)} 米${p.bank ? `，倾斜 ${p.bank}°` : ""}`),
      h("div", { class: "ed-grid-buttons" },
        button("升高 2 米", () => setPoint(q => { q.z = Math.round((q.z + 2) * 10) / 10; })),
        button("降低 2 米", () => setPoint(q => { q.z = Math.round((q.z - 2) * 10) / 10; })),
        button("放平", () => setPoint(q => { q.z = 0; delete q.bank; }), { title: "回到地面高度，不倾斜" }),
        button("向左倾", () => setPoint(q => { q.bank = Math.min(45, (q.bank ?? 0) + 8); })),
        button("向右倾", () => setPoint(q => { q.bank = Math.max(-45, (q.bank ?? 0) - 8); })),
        button("删除点", () => app.deleteSelection(), { disabled: road.points.length <= 3 && road.closed })),
      button("在后面插入一个点", () => {
        commit(r => {
          const a = r.points[point]!, b = r.points[(point + 1) % r.points.length] ?? a;
          r.points.splice(point + 1, 0, { x: (a.x + b.x) / 2 + (b === a ? 10 : 0), y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
        });
        app.state.select({ kind: "road", id: road.id, point: point + 1 });
      }, { class: "ed-small" })));
  }
  if (road.route) {
    const rows = app.state.design.items.rows.filter(row => row.road === road.id);
    body.append(section("道具箱（道具赛）",
      h("div", { class: "ed-note" }, rows.length ? `${rows.length} 排、${rows.reduce((sum, row) => sum + row.count, 0)} 个道具箱。` : "还没有道具箱：只能竞速。"),
      h("div", { class: "ed-grid-buttons" },
        button("自动布置", () => app.autoItems()),
        button("点路放一排", () => app.setTool({ kind: "items" })),
        button("全部清除", () => app.clearItems(), { disabled: !rows.length }))));
  }
  body.append(more(`road-fields`, "更多设置（贴图长度、厚度、起点、每排道具箱…）", fields => {
    const selection = app.state.selection;
    const current = selection?.kind === "road" ? app.state.road(selection.id) : undefined;
    if (current) renderRoad(app, fields, current, selection?.kind === "road" ? selection.point : undefined);
  }));
}

function renderMapSimple(app: EditorApp, body: HTMLElement): void {
  const design = app.state.design;
  const route = design.roads.find(road => road.route);
  const routeReady = !!route && route.closed && route.points.length >= 3;
  const issues = validateDesign(design);
  const step = (index: number, done: boolean, now: boolean, text: string) =>
    h("div", { class: `ed-step ${done ? "ed-done" : ""} ${now ? "ed-now" : ""}` }, h("b", {}, done ? "✓" : String(index)), h("span", {}, text));
  const boxes = itemBoxCount(design);
  body.append(section("做一张地图",
    h("div", { class: "ed-steps" },
      step(1, routeReady, !routeReady, routeReady ? `比赛路线 ${sampleRoad(route!, 4).total.toFixed(0)} 米` : "铺赛道：素材栏“赛道”里选一种形状，或者自己画"),
      step(2, design.pieces.length > 0, routeReady && !design.pieces.length, design.pieces.length
        ? `已摆 ${design.pieces.length} 个物件` : "摆东西：素材栏里挑建筑、树、路灯，在地图上点击放置"),
      step(3, boxes > 0, routeReady && design.pieces.length > 0 && !boxes, boxes ? `${boxes} 个道具箱，可以开道具赛` : "（可选）放道具箱：“机关道具 → 道具箱”"),
      step(4, false, routeReady && !issues.length, "点工具栏“试跑”开一圈，满意了就“发布”")),
    h("div", { class: "ed-actions" }, button("新建向导…", () => app.actions.newMap(), { class: "ed-small" }))));
  const themes = Object.entries(THEME_TITLES).sort((a, b) => a[1].localeCompare(b[1], "zh-CN")) as Array<[string, string]>;
  body.append(section("地图设置",
    textField("名称", design.name, value => app.state.commit(d => { d.name = value.trim() || d.name; }), MAP_LIMITS.nameLength),
    numberField("圈数", design.laps, value => app.state.commit(d => { d.laps = Math.round(value); }), { step: 1, min: 1, max: 9, digits: 0 }),
    numberField("难度", design.difficulty, value => app.state.commit(d => { d.difficulty = Math.round(value); }), { step: 1, min: 1, max: 5, digits: 0, unit: "星" }),
    selectField("音乐", design.theme, themes, value => app.state.commit(d => { d.theme = value; })),
    h("div", { class: "ed-note" }, "换整套风格（天空、路面、护栏、地面）：素材栏“环境 → 主题套装”。")));
  body.append(section("检查",
    issues.length ? h("div", { class: "ed-note" }, ...issues.flatMap(issue => [`· ${issue}`, h("br")])) : h("div", { class: "ed-note" }, "没有问题，可以试跑和发布。")));
  body.append(more("map-ground", "地面", fields => {
    const ground = app.state.design.ground;
    fields.append(checkField("铺一块地面", !!ground, on => app.state.commit(d => { d.ground = on ? defaultGround() : null; })));
    if (!ground) return;
    const texture = app.dock.textureFor(ground.texture.track, ground.texture.name);
    fields.append(
      h("div", { class: "ed-swatch" }, texture ? app.dock.sprite(texture.slot, 40) : h("div", { class: "ed-sprite" }),
        h("span", { class: "ed-name" }, texture ? textureLabel(texture) : ground.texture.name), button("换…", () => app.dock.open("ground"), { class: "ed-small" })),
      numberField("边长", ground.size, value => app.state.commit(d => { d.ground!.size = value; }), { step: 200, min: 50, max: MAP_LIMITS.extent * 2, unit: "米" }),
      checkField("可以在地面上开", ground.drivable, on => app.state.commit(d => { d.ground!.drivable = on; })));
  }));
  body.append(more("map-fields", "高级设置", fields => renderMap(app, fields)));
}
