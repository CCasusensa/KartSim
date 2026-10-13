/**
 * 地图工坊入口（client/editor.html）：读取与游戏相同的资源（同源 OPFS 缓存），
 * 装上游戏外观，再打开编辑器。
 */
import { installLocalMultiplayerConfig } from "../../multiplayer/local-config";
import { loadLegacyResourceBundle } from "../../resources/legacy-adapter";
import { Sw } from "../../generated/library.js";
import { EditorAssets, type EditorLibrary } from "./assets";
import { EditorApp } from "./app";
import { installEditorSkin } from "./skin";
import { h } from "./dom";
import { listDesigns, loadDesign } from "../draft-store";
import { loadCatalog } from "../catalog";
import { openNewMapWizard } from "./wizard";

installLocalMultiplayerConfig();

const root = document.getElementById("editor")!;
const bar = h("div");
const text = h("div", {}, "正在读取资源索引…");
const loading = h("div", { class: "ed-loading" }, h("h1", {}, "地图工坊"), text, h("div", { class: "ed-progress" }, bar));
document.body.append(loading);
const progress = (value: number, message?: string) => {
  bar.style.width = `${Math.round(Math.min(1, value) * 100)}%`;
  if (message) text.textContent = message;
};

try {
  const bundle = await loadLegacyResourceBundle("p3553", event => {
    if (event.background) return;
    progress(0.1 + 0.3 * (event.totalBytes ? event.loadedBytes / event.totalBytes : 0), `正在读取 ${event.file}`);
  });
  progress(0.45, "正在解析资源索引…");
  const library = await (Sw as unknown as { load(sources: unknown, progress: unknown, indexes: unknown): Promise<EditorLibrary> })
    .load(bundle.sources, (event: { current: number; total: number }) => progress(0.45 + 0.4 * event.current / Math.max(1, event.total)), bundle.archiveIndexes);
  progress(0.9, "正在载入游戏界面素材…");
  await installEditorSkin(library);
  const assets = new EditorAssets(library);
  progress(0.96, "正在读取素材目录…");
  const [, catalog] = await Promise.all([assets.tracks(), loadCatalog()]);
  const app = new EditorApp(root, assets);
  app.dock.attach(catalog.data, catalog.sheets);
  app.resetDesign();
  (window as unknown as { __mapEditor?: EditorApp }).__mapEditor = app;
  loading.remove();
  // 游戏“自定义游戏”里的“在地图工坊修改 / 用地图工坊打开”：/editor.html?open=<地图 id>
  const open = new URLSearchParams(location.search).get("open");
  if (open && /^[0-9a-z]{6,16}$/.test(open)) {
    history.replaceState(history.state, "", location.pathname);
    if (await loadDesign(open)) await app.actions.openDraft(open);
    else await app.actions.openPublished(open);
  } else if (!(await listDesigns().catch(() => [])).length) {
    // 第一次来：直接打开新建向导
    openNewMapWizard(app, { firstRun: true });
  } else {
    app.say("欢迎回来！点“我的地图”接着做，或者“新地图”再做一张", 6000);
  }
} catch (error) {
  console.error(error);
  text.textContent = `地图工坊启动失败：${(error as Error).message}`;
}
