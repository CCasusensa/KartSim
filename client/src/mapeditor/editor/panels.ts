/**
 * 左侧素材库与右侧属性面板。
 */
import { DEFAULT_WALL, MAP_LIMITS, defaultGround, itemBoxCount, validateDesign, type MapDesign, type PieceDesign, type RoadDesign, type TextureRef, type WallDesign } from "../design";
import { sampleRoad } from "../road-geometry";
import { THEME_TITLES, type PieceInfo, type SourceTrack, type SurfaceTexture } from "../source-tracks";
import { listDesigns } from "../draft-store";
import type { EditorApp } from "./app";
import { button, checkField, clear, h, numberField, section, selectField, textField } from "./dom";

const SURFACE_NAMES: Record<string, string> = {
  surface: "路面", sound: "声音", dust: "尘土", rail: "轨道", movable: "移动", alphaBias: "透明偏移",
};

/** 原版属性值里的韩文（路面声音与特殊路面）。 */
const VALUE_NAMES: Record<string, string> = {
  모래바닥: "沙地", 눈바닥: "雪地", 나무다리: "木桥", 돌바닥: "石地", 물밟기: "踩水", 강철바닥: "钢板",
  돌다리: "石桥", 수풀바닥: "草丛", 철바닥: "铁板", 강철다리: "钢桥", 리셋: "掉落重置", 점프: "跳台",
};

function roadSummary(road: [string, string][] | undefined): string {
  if (!road) return "";
  if (!road.length) return "可行驶";
  return road.map(([key, value]) => key === "surface" && value === "리셋" ? "掉落重置"
    : `${SURFACE_NAMES[key] ?? key} ${VALUE_NAMES[value] ?? value}`).join("，");
}

function sizeText(info: PieceInfo): string {
  const size = info.max.map((v, i) => Math.max(0, v - info.min[i]!));
  return `${size[0]!.toFixed(0)}×${size[1]!.toFixed(0)}×${size[2]!.toFixed(0)} 米`;
}

function thumbImage(app: EditorApp, track: string, name: string): HTMLImageElement {
  const image = h("img", { alt: "" });
  void app.textureThumb(track, name).then(url => { if (url) image.src = url; });
  return image;
}

/** 一行贴图：缩略图、名字和“用选中贴图”按钮。 */
function textureRow(app: EditorApp, label: string, texture: TextureRef | undefined, apply: (picked: NonNullable<EditorApp["pickedTexture"]>) => void): HTMLElement {
  const picked = app.pickedTexture;
  return h("div", { class: "ed-texture" },
    texture ? thumbImage(app, texture.track, texture.name) : h("canvas"),
    h("span", { class: "ed-name", title: texture ? `${texture.track} / ${texture.name}` : "" }, `${label}：${texture?.name ?? "无"}`),
    button("换成选中贴图", () => picked && apply(picked), { class: "ed-small", disabled: !picked, title: picked ? `${picked.track} / ${picked.name}` : "先在素材库的“贴图”页点一张贴图" }));
}

// ====================================================================== 左侧

let leftKey = "";

export function renderLeftPanel(app: EditorApp): void {
  const source = app.source;
  const picks = source ? [...source.selected].sort((a, b) => a - b).join(",") : "";
  const key = JSON.stringify([app.leftTab, app.trackFilter.theme, app.browsing?.folder, app.sourceTab, app.mode === "source", picks,
    app.pickedTexture, app.leftVersion]);
  if (key === leftKey) return;
  leftKey = key;
  const scroll = app.left.querySelector(".ed-scroll")?.scrollTop ?? 0;
  const sameView = app.left.dataset.view === `${app.leftTab}:${app.browsing?.folder ?? ""}:${app.sourceTab}`;
  clear(app.left);
  app.left.dataset.view = `${app.leftTab}:${app.browsing?.folder ?? ""}:${app.sourceTab}`;
  app.left.append(h("div", { class: "k-caption" }, "素材库"));
  const tab = (label: string, value: typeof app.leftTab) => h("button", { class: `k-tab ${app.leftTab === value ? "k-on" : ""}`, type: "button",
    onclick: () => { app.leftTab = value; app.queueRender(); } }, label);
  app.left.append(h("div", { class: "ed-tabs" }, tab("官方赛道", "tracks"), tab("我的地图", "mine")));
  const body = h("div", { class: "ed-scroll" });
  if (app.leftTab === "mine") renderMine(app, body);
  else if (app.browsing) renderTrackDetail(app, app.browsing, body);
  else renderTrackList(app, body);
  app.left.append(body);
  if (sameView) requestAnimationFrame(() => { body.scrollTop = scroll; });
}

function renderTrackList(app: EditorApp, body: HTMLElement): void {
  const search = h("input", { class: "k-edit", type: "search", placeholder: "搜索赛道（名字或 id）" });
  search.value = app.trackFilter.text;
  search.addEventListener("keydown", event => event.stopPropagation());
  const theme = h("select", { class: "k-combo" }, h("option", { value: "" }, "全部主题"));
  body.append(h("div", { class: "ed-search" }, search, theme),
    h("div", { class: "ed-note" }, "选一条官方赛道，从里面挑物件、路面和墙的贴图，拼到自己的地图里。"));
  const list = h("div");
  body.append(list);
  void app.assets.tracks().then(tracks => {
    const themes = [...new Set(tracks.map(track => track.theme))];
    for (const id of themes) theme.append(h("option", { value: id }, THEME_TITLES[id] ?? id));
    theme.value = app.trackFilter.theme;
    theme.onchange = () => { app.trackFilter.theme = theme.value; app.queueRender(); };
    // 搜索只刷新列表，输入框保持焦点
    const fill = () => {
      clear(list);
      const text = app.trackFilter.text.trim().toLowerCase();
      const shown = tracks.filter(track => (!app.trackFilter.theme || track.theme === app.trackFilter.theme) &&
        (!text || track.title.toLowerCase().includes(text) || track.folder.toLowerCase().includes(text)));
      for (const track of shown) {
        list.append(h("div", { class: "ed-row k-row", title: track.folder, onclick: () => {
          app.browsing = track; app.sourceTab = "pieces"; app.queueRender();
        } }, h("span", { class: "ed-name" }, track.title), h("span", { class: "ed-meta" }, THEME_TITLES[track.theme] ?? track.theme)));
      }
      if (!shown.length) list.append(h("div", { class: "ed-empty" }, "没有符合条件的赛道。"));
    };
    search.addEventListener("input", () => { app.trackFilter.text = search.value; fill(); });
    fill();
  });
}

function renderTrackDetail(app: EditorApp, track: SourceTrack, body: HTMLElement): void {
  const viewing = app.mode === "source" && app.source?.track.folder === track.folder;
  body.append(
    h("div", { class: "ed-head" },
      button("‹ 返回", () => { if (viewing) app.closeSource(); app.browsing = undefined; app.queueRender(); }, { class: "ed-small" }),
      h("span", { class: "ed-name", title: track.folder }, track.title)),
    h("div", { class: "ed-actions" },
      viewing ? button("回到我的地图", () => app.closeSource(), { class: "ed-small" })
        : button("在视口中打开整条赛道", () => void app.openSource(track), { class: "ed-small", title: "在视口里看原赛道，直接点选要拿的物件" }),
      button("用它的天空和雾", () => { app.state.commit(design => { design.sky = track.folder; }); app.say(`天空改为「${track.title}」。`); },
        { class: "ed-small" }),
      button("用它的主题音乐", () => { app.state.commit(design => { design.theme = track.theme; }); app.say(`主题改为 ${THEME_TITLES[track.theme] ?? track.theme}。`); },
        { class: "ed-small" })),
  );
  const tab = (label: string, value: typeof app.sourceTab) => h("button", { class: `k-tab ${app.sourceTab === value ? "k-on" : ""}`, type: "button",
    onclick: () => { app.sourceTab = value; app.queueRender(); } }, label);
  body.append(h("div", { class: "ed-tabs" }, tab("物件", "pieces"), tab("贴图", "textures")));
  const list = h("div");
  body.append(list);
  list.append(h("div", { class: "ed-empty" }, "正在读取…"));
  if (app.sourceTab === "pieces") {
    void app.assets.pieces(track.folder).then(pieces => {
      clear(list);
      const selected = viewing ? app.source!.selected : app.listPicks(track.folder);
      const placeable = [...selected].sort((a, b) => a - b).map(index => pieces[index]!).filter(Boolean);
      list.append(h("div", { class: "ed-actions" },
        button(`放到我的地图（${placeable.length}）`, () => {
          if (viewing) app.closeSource();
          app.placePieces(track.folder, placeable);
          selected.clear();
          app.queueRender();
        }, { class: "ed-small ed-primary", disabled: !placeable.length }),
        button("清除选择", () => { selected.clear(); app.updateSourceBoxes(); app.queueRender(); }, { class: "ed-small", disabled: !selected.size }),
      ), h("div", { class: "ed-note" }, viewing ? "点列表或视口里的物件选取，Shift 多选；双击列表直接放进地图。"
        : "点选物件（Shift 多选），双击直接放进地图。想看原样可以先“在视口中打开整条赛道”。"));
      pieces.forEach((piece, index) => {
        const row = h("div", { class: `ed-row k-row ${selected.has(index) ? "k-selected" : ""}`, title: `${piece.name}　${piece.textures.slice(0, 6).join("、")}` },
          h("span", { class: "ed-name" }, piece.name),
          piece.drivable ? h("span", { class: `ed-flag ${piece.reset ? "ed-warn" : ""}` }, piece.reset ? "重置区" : "可行驶") : undefined,
          h("span", { class: "ed-meta" }, sizeText(piece)));
        row.addEventListener("click", event => {
          if (viewing) { app.selectSourcePiece(index, event.shiftKey); app.focusSelection(); }
          else {
            if (!event.shiftKey) selected.clear();
            if (selected.has(index) && event.shiftKey) selected.delete(index); else selected.add(index);
            app.leftVersion++;
            app.queueRender();
          }
        });
        row.addEventListener("dblclick", () => {
          if (viewing) app.closeSource();
          app.placePieces(track.folder, [piece]);
        });
        list.append(row);
      });
    }).catch(error => { clear(list); list.append(h("div", { class: "ed-empty" }, `读取失败：${(error as Error).message}`)); });
  } else {
    void app.assets.surfaces(track.folder).then(textures => {
      clear(list);
      list.append(h("div", { class: "ed-note" }, "点一张贴图选中它，再到右侧属性里“换成选中贴图”。带“可行驶”的是原版路面（含路面属性：沙地、冰面、加速带等）。"));
      textures.slice(0, 240).forEach((texture: SurfaceTexture) => {
        const picked = app.pickedTexture?.track === track.folder && app.pickedTexture.name === texture.name &&
          JSON.stringify(app.pickedTexture.road) === JSON.stringify(texture.road);
        const row = h("div", { class: `ed-row k-row ${picked ? "k-selected" : ""}`, title: texture.name },
          thumbImage(app, track.folder, texture.name),
          h("span", { class: "ed-name" }, texture.name, h("br"), h("span", { class: "ed-meta" }, roadSummary(texture.road) || "装饰", texture.alpha ? `　${texture.alpha === "test" ? "镂空" : "半透明"}` : "")));
        row.addEventListener("click", () => {
          app.pickedTexture = { track: track.folder, name: texture.name, road: texture.road, alpha: texture.alpha };
          app.say(`已选中贴图 ${texture.name}，到右侧属性里应用。`);
          app.queueRender();
        });
        list.append(row);
      });
    }).catch(error => { clear(list); list.append(h("div", { class: "ed-empty" }, `读取失败：${(error as Error).message}`)); });
  }
}

function renderMine(app: EditorApp, body: HTMLElement): void {
  body.append(h("div", { class: "ed-actions" },
    button("新建地图", () => app.actions.newMap(), { class: "ed-small" }),
    button("导入文件", () => app.actions.importFile(), { class: "ed-small" })));
  const local = h("div");
  const remote = h("div");
  body.append(section("本机草稿", local), section("已发布（服务器）", remote));
  void listDesigns().then(designs => {
    if (!designs.length) { local.append(h("div", { class: "ed-empty" }, "还没有保存过的地图。")); return; }
    for (const design of designs) {
      local.append(h("div", { class: `ed-row k-row ${design.id === app.state.design.id ? "k-selected" : ""}` },
        h("span", { class: "ed-name" }, design.name),
        h("span", { class: "ed-meta" }, new Date(design.updatedAt).toLocaleDateString()),
        button("打开", () => void app.actions.openDraft(design.id), { class: "ed-small" }),
        button("删除", () => void app.actions.deleteDraft(design), { class: "ed-small" })));
    }
  }).catch(() => local.append(h("div", { class: "ed-empty" }, "浏览器不能读取本机草稿。")));
  void app.actions.myMaps().then(maps => {
    if (maps === undefined) { remote.append(h("div", { class: "ed-empty" }, "登录后显示（在同一浏览器打开游戏登录即可）。")); return; }
    if (!maps.length) { remote.append(h("div", { class: "ed-empty" }, "还没有发布过地图。")); return; }
    for (const map of maps) {
      remote.append(h("div", { class: "ed-row k-row" },
        h("span", { class: "ed-name" }, map.name),
        h("span", { class: "ed-meta" }, `${(map.size / 1e6).toFixed(1)} MB`),
        button("打开", () => void app.actions.openPublished(map.id), { class: "ed-small" }),
        button("下架", () => void app.actions.unpublish(map), { class: "ed-small" })));
    }
  });
}

// ====================================================================== 右侧

export function renderRightPanel(app: EditorApp): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement && app.right.contains(focused) && focused.type !== "checkbox") return;
  clear(app.right);
  app.right.append(h("div", { class: "k-caption" }, "属性"));
  const body = h("div", { class: "ed-scroll" });
  app.right.append(body);
  const selection = app.state.selection;
  if (app.mode === "source") {
    body.append(h("div", { class: "ed-note" }, "正在查看官方赛道，选好物件后点“放到我的地图”。"), button("回到我的地图", () => app.closeSource()));
    return;
  }
  if (selection?.kind === "pieces") renderPieces(app, body, app.state.selectedPieces());
  else if (selection?.kind === "road") {
    const road = app.state.road(selection.id);
    if (road) renderRoad(app, body, road, selection.point);
  } else renderMap(app, body);
}

function renderPieces(app: EditorApp, body: HTMLElement, pieces: PieceDesign[]): void {
  const commitAll = (change: (piece: PieceDesign) => void) => {
    const ids = new Set(pieces.map(piece => piece.id));
    app.state.commit(design => { for (const piece of design.pieces) if (ids.has(piece.id)) change(piece); });
  };
  const actions = h("div", { class: "ed-actions" },
    button("复制", () => app.duplicateSelection(), { class: "ed-small", title: "Ctrl+D" }),
    button("删除", () => app.deleteSelection(), { class: "ed-small", title: "Delete" }),
    button("落到地面", () => app.dropToGround(), { class: "ed-small", title: "放到正下方的路面、地面或其他物件上" }),
    button("视角聚焦", () => app.focusSelection(), { class: "ed-small", title: "F" }));
  if (pieces.length === 1) {
    const piece = pieces[0]!;
    const set = (axis: "position" | "rotation" | "scale", index: number) => (value: number) => commitAll(p => { p[axis][index] = value; });
    body.append(
      section("摆件",
        h("div", { class: "ed-note" }, h("b", {}, piece.label), `　来自 `, h("span", { "data-track": piece.track }, piece.track)),
        actions),
      section("位置（米）", numberField("东", piece.position[0], set("position", 0), { step: 0.5 }),
        numberField("北", piece.position[1], set("position", 1), { step: 0.5 }), numberField("高", piece.position[2], set("position", 2), { step: 0.5 })),
      section("旋转（度）", numberField("朝向", piece.rotation[0], set("rotation", 0), { step: 15 }),
        numberField("俯仰", piece.rotation[1], set("rotation", 1), { step: 15 }), numberField("横滚", piece.rotation[2], set("rotation", 2), { step: 15 }),
        h("div", { class: "ed-actions" }, button("重置旋转", () => commitAll(p => { p.rotation = [0, 0, 0]; }), { class: "ed-small" }))),
      section("缩放", numberField("整体", piece.scale[0], value => commitAll(p => { p.scale = [value, value, value]; }), { step: 0.1, min: 0.05, max: 50, digits: 3 }),
        h("br"),
        numberField("东西", piece.scale[0], set("scale", 0), { step: 0.1, min: 0.05, max: 50, digits: 3 }),
        numberField("南北", piece.scale[1], set("scale", 1), { step: 0.1, min: 0.05, max: 50, digits: 3 }),
        numberField("上下", piece.scale[2], set("scale", 2), { step: 0.1, min: 0.05, max: 50, digits: 3 })),
    );
    void app.assets.track(piece.track).then(track => {
      const label = body.querySelector(`[data-track="${piece.track}"]`);
      if (track && label) label.textContent = track.title;
    });
    if (piece.group) body.append(h("div", { class: "ed-actions" }, button("拆开这一组", () => {
      const group = piece.group;
      app.state.commit(design => { for (const p of design.pieces) if (p.group === group) delete p.group; });
    }, { class: "ed-small" })));
    return;
  }
  const groups = new Set(pieces.map(piece => piece.group ?? piece.id));
  body.append(section(`已选 ${pieces.length} 个摆件`, actions,
    h("div", { class: "ed-note" }, "用视口里的手柄整体移动、旋转、缩放。"),
    h("div", { class: "ed-actions" },
      button("组成一组", () => { const id = app.state.newId("g"); commitAll(p => { p.group = id; }); }, { class: "ed-small", disabled: groups.size < 2 }),
      button("拆开分组", () => commitAll(p => { delete p.group; }), { class: "ed-small" }),
      button("重置旋转", () => commitAll(p => { p.rotation = [0, 0, 0]; }), { class: "ed-small" }))));
}

function wallEditor(app: EditorApp, road: RoadDesign, side: "left" | "right"): HTMLElement {
  const wall = road.walls[side];
  const label = side === "left" ? "左护墙" : "右护墙";
  const commitWall = (change: (wall: WallDesign) => void) => app.state.commit(design => {
    const r = design.roads.find(x => x.id === road.id)!;
    const w = r.walls[side];
    if (w) change(w);
  });
  const enable = checkField(label, !!wall, on => app.state.commit(design => {
    const r = design.roads.find(x => x.id === road.id)!;
    const other = r.walls[side === "left" ? "right" : "left"];
    r.walls[side] = on ? (other ? structuredClone(other) : structuredClone(DEFAULT_WALL)) : null;
  }));
  if (!wall) return h("div", {}, enable);
  return h("div", {}, enable,
    checkField("显示", wall.visible, on => commitWall(w => { w.visible = on; })),
    numberField("高", wall.height, value => commitWall(w => { w.height = value; }), { step: 0.2, min: MAP_LIMITS.wallHeight[0], max: MAP_LIMITS.wallHeight[1] }),
    textureRow(app, "贴图", wall.texture, picked => commitWall(w => { w.texture = { track: picked.track, name: picked.name, alpha: picked.alpha }; })));
}

function renderRoad(app: EditorApp, body: HTMLElement, road: RoadDesign, point: number | undefined): void {
  const commit = (change: (road: RoadDesign, design: MapDesign) => void) =>
    app.state.commit(design => change(design.roads.find(x => x.id === road.id)!, design));
  const sample = sampleRoad(road, 2);
  body.append(section("道路",
    textField("名称", road.name, value => commit(r => { r.name = value.trim() || r.name; })),
    checkField("比赛路线", road.route, on => commit((r, design) => {
      if (on) for (const other of design.roads) other.route = false;
      r.route = on;
      if (on) r.closed = true;
    })),
    checkField("闭合成环", road.closed, on => commit(r => { r.closed = on; if (!on) r.route = false; })),
    h("div", { class: "ed-note" }, `${road.points.length} 个控制点，长 ${sample.total.toFixed(0)} 米${road.route ? "；比赛路线：圈数、检查点、起点和小地图都按它生成" : ""}`),
    numberField("宽度", road.width, value => commit(r => { r.width = value; }), { step: 1, min: MAP_LIMITS.width[0], max: MAP_LIMITS.width[1], unit: "米" }),
    h("div", { class: "ed-actions" },
      button("继续画路", () => app.startDraw(), { class: "ed-small" }),
      button("反转方向", () => commit(r => { r.points.reverse(); }), { class: "ed-small" }),
      button("删除道路", () => { app.state.select({ kind: "road", id: road.id }); app.deleteSelection(); }, { class: "ed-small" })),
  ));
  if (road.route) {
    body.append(section("起点",
      numberField("起点线", app.state.design.start.offset, value => app.state.commit(design => { design.start.offset = value; }),
        { step: 5, min: 0, max: Math.max(0, Math.floor(sample.total)), unit: "米（从第 1 个点沿路量）" })));
  }
  body.append(section("路面",
    textureRow(app, "路面", road.surface, picked => commit(r => {
      r.surface = { track: picked.track, name: picked.name, road: picked.road ?? [], alpha: picked.alpha };
    })),
    h("div", { class: "ed-note" }, `路面属性：${roadSummary(road.surface.road) || "可行驶"}`),
    numberField("贴图长", road.uvLength, value => commit(r => { r.uvLength = value; }), { step: 1, min: 1, max: 200, unit: "米/张" }),
    numberField("厚度", road.thickness, value => commit(r => { r.thickness = value; }), { step: 0.5, min: 0, max: 20, unit: "米" }),
    road.thickness > 0 ? textureRow(app, "侧壁", road.underside ?? road.surface, picked => commit(r => { r.underside = { track: picked.track, name: picked.name }; })) : undefined,
  ));
  body.append(section("护墙", wallEditor(app, road, "left"), wallEditor(app, road, "right")));
  body.append(itemSection(app, road, point, sample));
  if (point !== undefined && road.points[point]) {
    const p = road.points[point]!;
    const setPoint = (key: "x" | "y" | "z" | "width" | "bank") => (value: number) => commit(r => { r.points[point]![key] = value; });
    body.append(section(`控制点 ${point + 1}`,
      numberField("东", p.x, setPoint("x"), { step: 1 }), numberField("北", p.y, setPoint("y"), { step: 1 }), numberField("高", p.z, setPoint("z"), { step: 0.5 }),
      h("br"),
      numberField("倾斜", p.bank ?? 0, setPoint("bank"), { step: 2, min: -45, max: 45, unit: "度" }),
      checkField("单独宽度", p.width !== undefined, on => commit(r => { if (on) r.points[point]!.width = r.width; else delete r.points[point]!.width; })),
      p.width !== undefined ? numberField("宽", p.width, setPoint("width"), { step: 1, min: MAP_LIMITS.width[0], max: MAP_LIMITS.width[1] }) : undefined,
      h("div", { class: "ed-actions" },
        button("在后面插入点", () => {
          commit(r => {
            const a = r.points[point]!, b = r.points[(point + 1) % r.points.length] ?? a;
            r.points.splice(point + 1, 0, { x: (a.x + b.x) / 2 + (b === a ? 10 : 0), y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
          });
          app.state.select({ kind: "road", id: road.id, point: point + 1 });
        }, { class: "ed-small" }),
        button("删除这个点", () => app.deleteSelection(), { class: "ed-small", disabled: road.points.length <= 2 }),
        button("设为起点", () => commit(r => {
          r.points = [...r.points.slice(point), ...r.points.slice(0, point)];
        }), { class: "ed-small", disabled: !road.closed || point === 0, title: "把这个点变成第 1 个点（起点线从这里量）" }))));
  } else {
    body.append(h("div", { class: "ed-note" }, "点视口里的白色圆点选中控制点，拖动手柄移动它。"));
  }
}

/** 道具箱（道具赛）：这条路上的各排，以及加一排、自动布置。 */
function itemSection(app: EditorApp, road: RoadDesign, point: number | undefined, sample: ReturnType<typeof sampleRoad>): HTMLElement {
  const rows = app.state.design.items.rows.filter(row => row.road === road.id);
  const total = Math.max(1, Math.floor(sample.total));
  const addRow = (distance: number, count = 4) => {
    if (app.state.design.items.rows.length >= MAP_LIMITS.itemRows) { app.say(`道具箱最多 ${MAP_LIMITS.itemRows} 排。`); return; }
    app.state.commit(design => {
      design.items.rows.push({ id: app.state.newId("i"), road: road.id, distance: Math.round(distance) % total, count });
      design.items.rows.sort((a, b) => a.road === b.road ? a.distance - b.distance : 0);
    });
  };
  const pointDistance = () => {
    const p = point !== undefined ? road.points[point] : undefined;
    if (!p) return undefined;
    let best = 0;
    sample.points.forEach((q, i) => {
      if (Math.hypot(q[0] - p.x, q[1] - p.y) < Math.hypot(sample.points[best]![0] - p.x, sample.points[best]![1] - p.y)) best = i;
    });
    return sample.s[best]!;
  };
  const list = rows.map((row, index) => h("div", { class: "ed-texture" },
    h("span", { class: "ed-meta" }, `第 ${index + 1} 排`),
    numberField("距离", row.distance, value => app.state.commit(design => {
      const target = design.items.rows.find(item => item.id === row.id);
      if (target) target.distance = Math.round(value);
    }), { step: 10, min: 0, max: total, digits: 0, unit: "米" }),
    numberField("个数", row.count, value => app.state.commit(design => {
      const target = design.items.rows.find(item => item.id === row.id);
      if (target) target.count = Math.round(value);
    }), { step: 1, min: MAP_LIMITS.itemsPerRow[0], max: MAP_LIMITS.itemsPerRow[1], digits: 0 }),
    button("删除", () => app.state.commit(design => { design.items.rows = design.items.rows.filter(item => item.id !== row.id); }),
      { class: "ed-small" })));
  const startAhead = (road.route ? app.state.design.start.offset : 0) + 80;
  return section("道具箱（道具赛）",
    h("div", { class: "ed-note" }, rows.length
      ? `这条路上 ${rows.length} 排、${rows.reduce((sum, row) => sum + row.count, 0)} 个道具箱。距离从第 1 个控制点沿路量。`
      : "放了道具箱的地图发布后，道具房也能选它。"),
    ...list,
    h("div", { class: "ed-actions" },
      button("在选中点加一排", () => { const d = pointDistance(); if (d !== undefined) addRow(d); },
        { class: "ed-small", disabled: point === undefined, title: "先点一个白色控制点" }),
      button("在起点后加一排", () => addRow(startAhead), { class: "ed-small" }),
      button("自动布置", () => {
        const spacing = Math.max(150, Math.min(400, total / 4));
        app.state.commit(design => {
          design.items.rows = design.items.rows.filter(row => row.road !== road.id);
          for (let d = startAhead; d < startAhead + total - spacing / 2; d += spacing)
            design.items.rows.push({ id: app.state.newId("i"), road: road.id, distance: Math.round(d) % total, count: 4 });
          design.items.rows = design.items.rows.slice(0, MAP_LIMITS.itemRows);
        });
        app.say("已按路线长度每隔一段放一排道具箱（每排 4 个）。");
      }, { class: "ed-small", title: "清掉这条路上的道具箱，按间距重新放" }),
      rows.length ? button("全部清除", () => app.state.commit(design => {
        design.items.rows = design.items.rows.filter(row => row.road !== road.id);
      }), { class: "ed-small" }) : undefined));
}

function renderMap(app: EditorApp, body: HTMLElement): void {
  const design = app.state.design;
  const commit = (change: (design: MapDesign) => void) => app.state.commit(change);
  const themes = Object.entries(THEME_TITLES).sort((a, b) => a[1].localeCompare(b[1], "zh-CN")) as Array<[string, string]>;
  body.append(section("地图设置",
    textField("名称", design.name, value => commit(d => { d.name = value.trim() || d.name; }), MAP_LIMITS.nameLength),
    numberField("圈数", design.laps, value => commit(d => { d.laps = Math.round(value); }), { step: 1, min: 1, max: 9, digits: 0 }),
    numberField("难度", design.difficulty, value => commit(d => { d.difficulty = Math.round(value); }), { step: 1, min: 1, max: 5, digits: 0 }),
    selectField("主题", design.theme, themes, value => commit(d => { d.theme = value; })),
    h("div", { class: "ed-note" }, "主题决定选图界面的分类和比赛音乐。"),
    h("div", { class: "ed-note", "data-sky": "" }, `天空：${design.sky}（在素材库里打开一条赛道，点“用它的天空和雾”）`)));
  void app.assets.track(design.sky).then(track => {
    const note = body.querySelector("[data-sky]");
    if (track && note) note.textContent = `天空：${track.title}（在素材库里打开一条赛道，点“用它的天空和雾”）`;
  });
  const ground = design.ground;
  body.append(section("地面",
    checkField("铺一块地面", !!ground, on => commit(d => {
      d.ground = on ? defaultGround() : null;
    })),
    ground ? h("div", {},
      textureRow(app, "贴图", ground.texture, picked => commit(d => { d.ground!.texture = { track: picked.track, name: picked.name }; })),
      numberField("边长", ground.size, value => commit(d => { d.ground!.size = value; }), { step: 100, min: 50, max: MAP_LIMITS.extent * 2, unit: "米" }),
      numberField("高度", ground.z, value => commit(d => { d.ground!.z = value; }), { step: 0.5 }),
      numberField("贴图尺寸", ground.tile, value => commit(d => { d.ground!.tile = value; }), { step: 2, min: 1, max: 200, unit: "米" }),
      checkField("可以在地面上开", ground.drivable, on => commit(d => { d.ground!.drivable = on; }))) : undefined));
  const boxes = itemBoxCount(design);
  body.append(section("道具赛",
    h("div", { class: "ed-note" }, boxes
      ? `${boxes} 个道具箱（${design.items.rows.length} 排）：发布后竞速房和道具房都能选这张图。`
      : "还没有道具箱，只能用于竞速。选中比赛路线，在“道具箱（道具赛）”里放道具箱。")));
  const issues = validateDesign(design);
  body.append(section("检查",
    issues.length ? h("div", { class: "ed-note" }, ...issues.flatMap(issue => [`· ${issue}`, h("br")]))
      : h("div", { class: "ed-note" }, "可以试跑和发布。"),
    h("div", { class: "ed-actions" },
      button("新道路", () => app.startRoad(), { class: "ed-small" }))));
  body.append(section("怎么做一张地图",
    h("div", { class: "ed-note" },
      "1. 点工具栏“新道路”，在视口里依次点击放控制点，点回绿色起点闭合成环，这就是比赛路线。", h("br"),
      "2. 在左侧素材库选官方赛道，“贴图”页挑路面、护墙、地面贴图，选中道路后在右侧“换成选中贴图”。", h("br"),
      "3. “物件”页挑房子、树、广告牌、整段官方路段，放进地图后用 W/E/R 手柄摆好。", h("br"),
      "4. 点“试跑”在游戏的计时赛里跑一遍；满意后“发布”，多人竞速房就能选这张图。")));
}
