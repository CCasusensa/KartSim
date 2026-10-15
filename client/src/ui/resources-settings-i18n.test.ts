import assert from "node:assert/strict";
import test from "node:test";
import { resourceButtonState, rowStatus, statusText } from "./resource-panel";
import { resourceWindowDefinition, ResourceWindow } from "./resource-window";
import { SettingsWindow } from "./settings-window";
import { PauseMenuView } from "../timeattack/pause-menu-view";
import { ReplayConsole } from "./replay-console";
import { node } from "./bml-kit";
import type { GameLocale } from "../i18n/locale";

function withLocale(locale: GameLocale, run: () => void): void {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const locales = ["zh-CN", "en", "ko"] as const;
const resourceTitles = ["资源下载", "Resources", "리소스 다운로드"];
const progressLabels = ["下载中 37%", "Downloading 37%", "다운로드 중 37%"];
const completedLabels = ["已下载", "Downloaded", "다운로드 완료"];

test("resource window and live download progress follow all three languages", () => {
  locales.forEach((locale, index) => withLocale(locale, () => {
    const manager = { activeJobs: () => [], totals: () => ({ cachedBytes: 0, totalBytes: 1000 }) };
    assert.equal(resourceButtonState(manager).text, resourceTitles[index]);
    assert.equal(resourceButtonState({ ...manager, activeJobs: () => [
      { totalBytes: 1000, doneBytes: () => 370 } as never,
    ] }).text, progressLabels[index]);
    const complete = { state: "complete", totalBytes: 1000, cachedBytes: 1000, progressBytes: 1000,
      queued: false, downloading: false } as const;
    assert.equal(statusText(complete), completedLabels[index]);
    assert.equal(statusText({ ...complete, state: "partial", queued: true, progressBytes: 370 }), progressLabels[index]);
    assert.equal(rowStatus(complete), ["完成", "Done", "완료"][index]);
    const definition = resourceWindowDefinition(2);
    assert.equal(definition.children[0]!.attributes.find(attribute => attribute.name === "caption")?.value,
      resourceTitles[index]);
  }));
});

test("resource categories and dynamic counts translate before canvas drawing", () => {
  const group = { id: "tracks", title: "赛道", containers: ["track_one.rho", "track_two.rho"], bytes: 1024 };
  const view = Object.create(ResourceWindow.prototype) as any;
  Object.assign(view, { manager: { groups: [group], status: () => ({ state: "none" }) },
    current: () => group, titleOf: () => "", themes: () => [], themePage: 0 });
  locales.forEach((locale, index) => withLocale(locale, () => {
    const state = (name: string) => view.state(node("Label", { name }), new WeakMap(), new WeakMap());
    assert.equal(state("groupCaptionText").text,
      ["资源分类（1）", "Categories (1)", "리소스 분류 (1)"][index]);
    assert.equal(state("detailSize").text,
      ["共 1 KB · 2 个文件", "1 KB · 2 files", "1 KB · 파일 2개"][index]);
    assert.equal(state("themeHeaderText").text,
      ["主要文件（共 2 个，按大小）", "Largest files (2 total)", "주요 파일 (총 2개, 크기순)"][index]);
  }));
});

test("settings translate resource fallbacks, custom options and dynamic speed hints", () => {
  const view = Object.create(SettingsWindow.prototype) as SettingsWindow;
  Object.assign(view, { assets: { strings: new Map([["custom", "自定义设置"]]) },
    options: { speedLocked: true } });
  locales.forEach((locale, index) => withLocale(locale, () => {
    assert.equal(view.text("#sb(custom)"), ["自定义设置", "Custom settings", "사용자 설정"][index]);
    assert.equal(view.text("垂直同步（比赛）"), ["垂直同步（比赛）", "VSync (races)", "수직 동기화 (레이스)"][index]);
    assert.equal(view.speedChannelHint(), ["多人游戏的速度由房间统一决定，不能在个人设置中修改。",
      "Multiplayer speed is set by the room and cannot be changed in personal settings.",
      "멀티플레이 속도는 대기실에서 정하며 개인 설정에서는 변경할 수 없습니다."][index]);
  }));
});

test("English and Korean pause menus replace baked Chinese text while keeping the icons", () => {
  const images: unknown[] = [];
  const labels: string[] = [];
  const bitmaps: unknown[] = [];
  const view = Object.create(PauseMenuView.prototype) as PauseMenuView;
  const image = { image: {}, width: 104, height: 106 };
  Object.assign(view, { hits: ["retry", "menu", "resume"].map(action =>
    ({ action, rect: { x: 0, y: 0, width: 104, height: 106 } })),
  context: { drawImage: (...args: unknown[]) => images.push(args) },
  dependencies: { buttonState: () => 0, fontFamily: "sans-serif",
    drawText: (_context: unknown, label: string) => labels.push(label),
    drawButton: (_context: unknown, bitmap: unknown) => bitmaps.push(bitmap) } });
  locales.forEach((locale, index) => withLocale(locale, () => {
    images.length = labels.length = bitmaps.length = 0;
    view.drawButton("retry", [image]);
    view.drawButton("menu", [image]);
    view.drawButton("resume", [image]);
    assert.equal(bitmaps.length, 3);
    assert.equal(images.length, index === 0 ? 0 : 2);
    assert.deepEqual(labels, [[], ["Retry", "Main menu"], ["다시 시작", "메뉴로"]][index]);
  }));
});

test("replay rank labels translate surrounding UI without changing player names", () => {
  const view = Object.create(ReplayConsole.prototype) as any;
  Object.assign(view, { rows: new WeakMap(), options: { observe: {
    clock: { paused: false, rate: 1 }, ranking: [0], riders: [{ name: "玩家{rank}" }], watched: 0,
  } } });
  locales.forEach((locale, index) => withLocale(locale, () => {
    assert.equal(view.state(node("ImageButton", { name: "라이더1" })).label,
      ["第 1 名 玩家{rank}", "Rank 1: 玩家{rank}", "1위 玩家{rank}"][index]);
  }));
});
