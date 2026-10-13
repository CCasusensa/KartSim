/**
 * 地图工坊的“试跑”：编辑器打开 `/?testmap=<地图 id>`，游戏启动、登录完成并
 * 回到首页后，把计时赛的赛道换成这张草稿，再翻到计时赛页面（与点“单人
 * 游戏 → 练习计时赛”相同），玩家点“开始”即可。
 */
import { draftTrackId } from "./design";
import { customTrackPath } from "./custom-tracks";

interface TestDriveApp {
  ready?: { activeHome?: unknown; disposed?: boolean };
  session?: { selection?: Record<string, unknown> & { vehiclePath?: string } };
  assets?: { library?: { timeAttackTrackCatalog(): Promise<Array<{ id: string }>> } };
  enterTimeAttackReady(): Promise<unknown>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 读取并去掉地址里的 testmap 参数（刷新页面不会再次触发）。 */
export function takeTestMapParameter(): string | undefined {
  if (typeof location === "undefined") return undefined;
  const url = new URL(location.href);
  const id = url.searchParams.get("testmap") ?? undefined;
  if (!id) return undefined;
  url.searchParams.delete("testmap");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  return /^[0-9a-z]{6,16}$/.test(id) ? id : undefined;
}

export async function startTestDrive(mapId: string, timeoutMs = 10 * 60_000): Promise<boolean> {
  const trackId = draftTrackId(mapId);
  const deadline = Date.now() + timeoutMs;
  let app: TestDriveApp | undefined;
  // 等首页出现（新账号要先建好车手）
  while (Date.now() < deadline) {
    app = (window as unknown as { __kartRenderQaApp?: TestDriveApp }).__kartRenderQaApp;
    if (app?.ready?.activeHome && app.session?.selection?.vehiclePath) break;
    app = undefined;
    await sleep(500);
  }
  if (!app?.session?.selection) return false;
  const catalog = await app.assets?.library?.timeAttackTrackCatalog();
  if (!catalog?.some(track => track.id === trackId)) {
    console.warn("试跑的地图草稿没有登记", trackId);
    return false;
  }
  app.session.selection = { ...app.session.selection, trackId, mapPath: customTrackPath(trackId) };
  await app.enterTimeAttackReady();
  const { closeReadyHome } = await import("../timeattack/ready-home");
  closeReadyHome(app.ready as Parameters<typeof closeReadyHome>[0]);
  return true;
}
