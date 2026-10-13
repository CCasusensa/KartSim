/**
 * 存取、检查、试跑和发布。
 */
import { MAP_LIMITS, itemBoxCount, parseDesign, randomId, validateDesign, type MapDesign, type Vec3 } from "../design";
import { PACKAGE_EXTENSION, decodeMapPackage, encodeMapPackage, isZip } from "../map-package";
import { deleteDraft, loadBuild, loadDesign, saveBuild, saveDesign, type StoredBuild } from "../draft-store";
import {
  dataServiceOrigin, deleteMap, fetchMapDesign, listMyMaps, publishMap, sha256Hex, storedSessionToken,
} from "../map-service";
import type { CustomMapSummary } from "../custom-tracks";
import { buildCustomTrack, type BuiltTrack } from "../track-builder";
import { sampleRoad } from "../road-geometry";
import { THEME_TITLES } from "../source-tracks";
import { formats } from "./assets";
import type { EditorApp } from "./app";
import { button, h } from "./dom";
import { toThree } from "./viewport";

interface Modal { close(): void; body: HTMLElement; buttons: HTMLElement; setProgress(value: number, text?: string): void }

export function modal(title: string, content: string | HTMLElement, buttons: Array<[string, () => void]> = [["确定", () => undefined]]): Modal {
  const body = h("div", { class: "ed-body" }, content);
  const row = h("div", { class: "ed-buttons" });
  const dialog = h("div", { class: "k-dialog" }, h("div", { class: "k-caption" }, title), body, row);
  const root = h("div", { class: "ed-modal" }, dialog);
  const close = () => root.remove();
  for (const [label, action] of buttons) row.append(button(label, () => { close(); action(); }));
  document.body.append(root);
  let bar: HTMLElement | undefined;
  return {
    close, body, buttons: row,
    setProgress(value, text) {
      if (!bar) { bar = h("div"); body.append(h("div", { class: "ed-progress" }, bar)); }
      bar.style.width = `${Math.round(value * 100)}%`;
      if (text !== undefined) body.firstChild!.textContent = text;
    },
  };
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("截图失败。");
  return new Uint8Array(await blob.arrayBuffer());
}

export class EditorActions {
  private account?: { nickname: string; token: string };
  private accountChecked = false;

  constructor(private readonly app: EditorApp) {
    void this.refreshAccount();
    window.addEventListener("focus", () => void this.refreshAccount());
    window.addEventListener("beforeunload", event => { if (this.app.state.dirty) event.preventDefault(); });
  }

  // ------------------------------------------------------------------ 账号

  async refreshAccount(): Promise<void> {
    const token = storedSessionToken();
    if (!token) { this.account = undefined; this.accountChecked = true; this.app.updateStatus(); return; }
    try {
      const response = await fetch(`${dataServiceOrigin()}/multiplayer/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      const body = response.ok ? await response.json() as { nickname?: string; account?: { nickname?: string } } : undefined;
      const nickname = body?.account?.nickname ?? body?.nickname;
      this.account = nickname ? { nickname, token } : undefined;
    } catch {
      this.account = undefined;
    }
    this.accountChecked = true;
    this.app.updateStatus();
  }

  accountLabel(): string {
    if (!this.accountChecked) return "";
    return this.account ? `账号：${this.account.nickname}` : "未登录（发布前先在游戏里登录）";
  }

  async myMaps(): Promise<CustomMapSummary[] | undefined> {
    const token = storedSessionToken();
    if (!token) return undefined;
    try { return await listMyMaps(token); } catch { return undefined; }
  }

  // ------------------------------------------------------------------ 存取

  newMap(): void {
    const go = () => { this.app.resetDesign(); this.app.say("新地图。先点“新道路”画一条比赛路线。"); };
    if (this.app.state.dirty) modal("新建地图", "当前地图还没保存，确定新建吗？", [["新建", go], ["取消", () => undefined]]);
    else go();
  }

  async save(): Promise<boolean> {
    try {
      await saveDesign(this.app.state.design);
      this.app.state.markSaved();
      this.app.say("已保存到本机。");
      this.app.leftVersion++;
      this.app.queueRender();
      return true;
    } catch (error) {
      modal("保存失败", (error as Error).message);
      return false;
    }
  }

  openDialog(): void {
    this.app.leftTab = "mine";
    this.app.leftVersion++;
    this.app.queueRender();
    this.app.say("在左侧“我的地图”里选一张打开。");
  }

  async openDraft(id: string): Promise<void> {
    const open = async () => {
      const design = await loadDesign(id);
      if (!design) { modal("打开失败", "找不到这张草稿。"); return; }
      this.load(parseDesign(JSON.stringify(design)));
    };
    if (this.app.state.dirty && id !== this.app.state.design.id) modal("打开地图", "当前地图还没保存，确定打开另一张吗？", [["打开", () => void open()], ["取消", () => undefined]]);
    else await open();
  }

  async openPublished(id: string): Promise<void> {
    try {
      this.load(parseDesign(await fetchMapDesign(id)));
      this.app.say("已从服务器打开，修改后再发布会覆盖原版本。");
    } catch (error) {
      modal("打开失败", (error as Error).message);
    }
  }

  private load(design: MapDesign): void {
    this.app.closeSource();
    this.app.state.load(design);
    this.app.leftVersion++;
    const route = design.roads.find(road => road.route) ?? design.roads[0];
    const first = route?.points[0];
    this.app.viewport.lookAt(first ? [first.x, first.y, first.z] : [0, 0, 0], 420);
    this.app.say(`已打开「${design.name}」。`);
  }

  async deleteDraft(design: MapDesign): Promise<void> {
    modal("删除草稿", `删除本机草稿「${design.name}」？已发布的版本不受影响。`, [["删除", () => {
      void deleteDraft(design.id).then(() => { this.app.leftVersion++; this.app.queueRender(); });
    }], ["取消", () => undefined]]);
  }

  async unpublish(map: CustomMapSummary): Promise<void> {
    const token = storedSessionToken();
    if (!token) return;
    modal("下架地图", `从服务器删除「${map.name}」？已经在玩这张图的房间会找不到赛道。`, [["下架", () => {
      void deleteMap(map.id, token).then(() => { this.app.say("已下架。"); this.app.leftVersion++; this.app.queueRender(); })
        .catch(error => modal("下架失败", (error as Error).message));
    }], ["取消", () => undefined]]);
  }

  /** 导入设计文件（.json）或地图包（.kartmap）。 */
  importFile(): void {
    const input = h("input", { type: "file", accept: `.json,${PACKAGE_EXTENSION},application/json,application/zip` });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isZip(bytes)) await this.importPackage(bytes);
        else { this.load(parseDesign(new TextDecoder().decode(bytes))); this.app.state.dirty = true; }
      } catch (error) {
        modal("导入失败", (error as Error).message);
      }
    });
    input.click();
  }

  /** 地图包：设计进编辑器，赛道包存成本机地图（不用重新生成就能在计时赛里玩）。 */
  private async importPackage(bytes: Uint8Array): Promise<void> {
    const pack = await decodeMapPackage(bytes);
    const existing = await loadDesign(pack.design.id);
    const store = async () => {
      await saveDesign(pack.design);
      await saveBuild({ id: pack.design.id, summary: pack.summary, container: new Blob([pack.container as BlobPart]),
        card: pack.card ? new Blob([pack.card as BlobPart], { type: "image/png" }) : undefined,
        thumb: pack.thumb ? new Blob([pack.thumb as BlobPart], { type: "image/png" }) : undefined });
      this.load(pack.design);
      this.app.leftVersion++;
      modal("导入地图包", `已导入「${pack.design.name}」（${(pack.container.length / 1e6).toFixed(1)} MB${
        pack.summary.author ? `，作者 ${pack.summary.author}` : ""}）。\n可以直接试跑，也可以继续修改；` +
        "别人的地图要发布成自己的，请先“另存为”。", [["试跑", () => this.openTestDrive()], ["关闭", () => undefined]]);
    };
    if (existing && existing.updatedAt !== pack.design.updatedAt)
      modal("导入地图包", `本机已有同一张地图「${existing.name}」，覆盖成导入的版本吗？`, [["覆盖", () => void store()], ["取消", () => undefined]]);
    else await store();
  }

  /** 另存为一张新地图（新 id，可以以自己的名义发布）。 */
  saveAs(): void {
    const design = structuredClone(this.app.state.design);
    design.id = randomId();
    design.name = [...`${design.name}（副本）`].slice(0, MAP_LIMITS.nameLength).join("");
    design.updatedAt = Date.now();
    this.load(design);
    this.app.state.dirty = true;
    void this.save().then(() => this.app.say(`已另存为「${design.name}」。`));
  }

  private download(name: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    h("a", { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private fileName(extension: string): string {
    return `${this.app.state.design.name.replace(/[\\/:*?"<>|]/g, "_")}${extension}`;
  }

  /** 导出：地图包、赛道包（游戏格式）或设计文件。 */
  exportDialog(): void {
    modal("导出地图",
      "地图包（.kartmap）：一个文件装下整张地图——设计、生成好的赛道包和卡片图。发给别人后，在地图工坊“导入”就能修改或直接试跑。\n\n" +
      "赛道包（.rho）：与官方赛道完全相同的游戏格式文件（track_custom_<id>.rho），可以用 client/tools/city/register-container.mjs 登记进资源镜像。\n\n" +
      "设计文件（.json）：只有设计数据，体积最小，用同一套官方资源重新生成。",
      [["地图包", () => void this.exportPackage()], ["赛道包", () => void this.exportContainer()],
        ["设计文件", () => this.exportDesign()], ["取消", () => undefined]]);
  }

  exportDesign(): void {
    this.download(this.fileName(".json"), new Blob([JSON.stringify(this.app.state.design, null, 1)], { type: "application/json" }));
  }

  private async exportPackage(): Promise<void> {
    const result = await this.build("导出地图包");
    if (!result) return;
    const { built, stored } = result;
    const bytes = encodeMapPackage({ design: this.app.state.design, summary: stored.summary, container: built.container,
      card: stored.card ? new Uint8Array(await stored.card.arrayBuffer()) : undefined,
      thumb: stored.thumb ? new Uint8Array(await stored.thumb.arrayBuffer()) : undefined });
    this.download(this.fileName(PACKAGE_EXTENSION), new Blob([bytes as BlobPart], { type: "application/zip" }));
    this.app.say(`已导出地图包（${(bytes.length / 1e6).toFixed(1)} MB）。`);
  }

  private async exportContainer(): Promise<void> {
    const result = await this.build("导出赛道包");
    if (!result) return;
    this.download(result.built.containerName, new Blob([result.built.container as BlobPart], { type: "application/octet-stream" }));
    this.app.say(`已导出赛道包 ${result.built.containerName}。`);
  }

  // ------------------------------------------------------------------ 检查与生成

  check(): void {
    const issues = validateDesign(this.app.state.design);
    modal("检查地图", issues.length ? issues.map(issue => `· ${issue}`).join("\n") : "没有发现问题，可以试跑和发布。");
  }

  /** 赛道卡片和缩略图：从斜上方看整条路线，叠上路线描边（与官方卡片相同）。 */
  private async cards(): Promise<{ card: Uint8Array; thumb: Uint8Array }> {
    const design = this.app.state.design;
    const route = design.roads.find(road => road.route);
    const points = route ? sampleRoad(route, 4).points : [];
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, p[i]!); max[i] = Math.max(max[i]!, p[i]!); }
    const viewport = this.app.viewport;
    const backup = { position: viewport.camera.position.clone(), target: viewport.controls.target.clone() };
    if (points.length) {
      const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      const size = Math.max(max[0] - min[0], max[1] - min[1], 60);
      viewport.controls.target.copy(toThree(center));
      viewport.camera.position.copy(toThree([center[0], center[1] - size * 0.75, center[2] + size * 0.55]));
      viewport.camera.lookAt(viewport.controls.target);
    }
    const draw = (width: number, height: number) => {
      const canvas = viewport.snapshot(width, height);
      if (points.length) {
        const context = canvas.getContext("2d")!;
        const size = Math.max(max[0] - min[0], max[1] - min[1], 1);
        const scale = (height * 0.62) / size;
        const cx = width / 2, cy = height / 2;
        context.strokeStyle = "rgba(255,255,255,0.78)";
        context.lineWidth = Math.max(2, height / 40);
        context.lineJoin = "round";
        context.beginPath();
        points.forEach((p, i) => {
          const x = cx + (p[0] - (min[0] + max[0]) / 2) * scale, y = cy - (p[1] - (min[1] + max[1]) / 2) * scale;
          if (i) context.lineTo(x, y); else context.moveTo(x, y);
        });
        context.closePath();
        context.stroke();
      }
      return canvasPng(canvas);
    };
    try {
      return { card: await draw(352, 206), thumb: await draw(222, 130) };
    } finally {
      viewport.camera.position.copy(backup.position);
      viewport.controls.target.copy(backup.target);
    }
  }

  /** 生成赛道包，存进本机草稿；失败时弹出原因。 */
  private async build(title: string): Promise<{ built: BuiltTrack; stored: StoredBuild } | undefined> {
    const design = this.app.state.design;
    const issues = validateDesign(design);
    if (issues.length) { modal(title, `还不能生成：\n${issues.map(issue => `· ${issue}`).join("\n")}`); return undefined; }
    const progress = modal(title, "正在生成赛道…", []);
    progress.setProgress(0.05);
    try {
      await this.save();
      const { card, thumb } = await this.cards();
      const steps = ["生成道路", "复制官方摆件", "生成路线和小地图", "复制贴图", "打包"];
      const built = await buildCustomTrack(design, {
        library: this.app.assets.library, formats, card, thumb,
        onProgress: message => progress.setProgress(0.1 + 0.85 * (steps.indexOf(message) + 1) / steps.length, `${message}…`),
      });
      const sha256 = await sha256Hex(built.container);
      const summary: CustomMapSummary = {
        id: design.id, name: design.name, author: this.account?.nickname ?? "", theme: design.theme, laps: design.laps,
        difficulty: design.difficulty, roadExtent: built.roadExtent, sha256, size: built.container.length,
        items: itemBoxCount(design), files: built.files.map(file => ({ path: file.path, size: file.bytes.length })), updatedAt: Date.now(), source: "local",
      };
      const stored: StoredBuild = { id: design.id, summary, container: new Blob([built.container as BlobPart]),
        card: new Blob([card as BlobPart], { type: "image/png" }), thumb: new Blob([thumb as BlobPart], { type: "image/png" }) };
      await saveBuild(stored);
      progress.close();
      return { built, stored };
    } catch (error) {
      progress.close();
      console.error(error);
      modal(title, `生成失败：${(error as Error).message}`);
      return undefined;
    }
  }

  private warningsText(built: BuiltTrack): string {
    return built.warnings.length ? `\n\n注意：\n${built.warnings.slice(0, 12).map(w => `· ${w}`).join("\n")}` : "";
  }

  openTestDrive(): void {
    window.open(`/?testmap=${encodeURIComponent(this.app.state.design.id)}`, "kartsim-testdrive");
  }

  /** 生成后在游戏的计时赛里试跑（新标签页）。 */
  async testDrive(): Promise<void> {
    const result = await this.build("试跑");
    if (!result) return;
    const { built } = result;
    const open = () => this.openTestDrive();
    modal("试跑", `赛道包已生成（${(built.container.length / 1e6).toFixed(1)} MB，路线 ${built.routeLength.toFixed(0)} 米，${built.stats.gates} 个检查点）。\n` +
      `游戏页会打开计时赛并选好这张地图（标着“[草稿]”），点“开始”即可。${this.warningsText(built)}`,
    [["打开游戏试跑", open], ["关闭", () => undefined]]);
  }

  /** 上传到服务器，多人竞速房可选。 */
  async publish(): Promise<void> {
    await this.refreshAccount();
    if (!this.account) {
      modal("发布", "发布需要登录。请在同一个浏览器里打开游戏并登录，然后回到这里再点“发布”。",
        [["打开游戏", () => window.open("/", "kartsim-game")], ["关闭", () => undefined]]);
      return;
    }
    const result = await this.build("发布");
    if (!result) return;
    const { built, stored } = result;
    const progress = modal("发布", "正在上传…", []);
    progress.setProgress(0.5);
    try {
      const summary = await publishMap({
        design: this.app.state.design, summary: stored.summary, container: built.container,
        card: new Uint8Array(await stored.card!.arrayBuffer()), thumb: new Uint8Array(await stored.thumb!.arrayBuffer()),
      }, this.account.token);
      progress.close();
      this.app.leftVersion++;
      this.app.queueRender();
      modal("发布成功", `「${summary.name}」已发布（${(summary.size / 1e6).toFixed(1)} MB）。\n` +
        `单人游戏 → 自定义游戏里所有人都能玩到它；多人游戏的竞速房${summary.items > 0 ? "和道具房" : ""}里，在“选择赛道”的` +
        `“${THEME_TITLES[summary.theme] ?? summary.theme}”分类（或直接搜索名字）就能找到，其他玩家进房时会自动下载。` +
        `${summary.items > 0 ? "" : "\n（没有道具箱，道具房里选不到；在比赛路线的属性里放道具箱后重新发布即可。）"}${this.warningsText(built)}`);
    } catch (error) {
      progress.close();
      const code = (error as Error).message;
      const text: Record<string, string> = {
        LOGIN_REQUIRED: "登录已过期，请在游戏里重新登录。", MAP_NOT_OWNER: "这张地图属于别人（导入了别人的地图包或设计），请先点“另存为”变成自己的地图再发布。",
        TOO_MANY_MAPS: "每个账号最多发布 20 张地图，先下架一些旧地图。", MAP_TOO_LARGE: "赛道包超过 40 MB，减少一些摆件或换小一点的贴图。",
        INVALID_MAP: "服务器拒绝了这个赛道包（数据不完整）。", DATA_SERVICE_UNAVAILABLE: "连不上服务器。",
      };
      modal("发布失败", text[code] ?? code);
    }
  }

  help(): void {
    modal("地图工坊帮助",
      "【视角】右键拖动旋转，滚轮缩放，中键或按住空格左键拖动平移，方向键移动（Shift 加速），F 聚焦选中物。触控板可用 Alt+左键旋转。\n" +
      "【道路】“新道路”后在视口依次点击放控制点，点回绿色起点闭合。选中道路后点白色圆点选控制点，用手柄拖动；右侧可改宽度、倾斜、护墙、厚度。比赛路线必须闭合，路线方向就是行驶方向（可“反转方向”）。\n" +
      "【素材】左侧选一条官方赛道：“物件”页挑物件（可“在视口中打开整条赛道”直接点选），双击或“放到我的地图”放进来；“贴图”页点一张贴图，再在右侧对道路/护墙/地面“换成选中贴图”。带路面属性的贴图会保留原版效果（沙地、冰面、加速带、掉落重置区等）。\n" +
      "【摆放】W 移动、E 旋转、R 缩放，吸附开关在工具栏；Ctrl+D 复制，Delete 删除，“落到地面”把物件放到正下方的表面上。一起拿来的物件是一组，Ctrl+点击可单独选。\n" +
      "【道具赛】选中比赛路线，在“道具箱（道具赛）”里放道具箱（可自动布置）。有道具箱的地图发布后，道具房也能选它。\n" +
      "【试跑与发布】“试跑”生成赛道包并在游戏计时赛里打开（标着[草稿]，只有你能看到）；“发布”上传到服务器，所有人都能在“单人游戏 → 自定义游戏”里玩，多人竞速房（有道具箱时还有道具房）里也能选。\n" +
      "【导出与导入】“导出”可以存成地图包（.kartmap，整张地图一个文件，发给别人后“导入”即可修改或试跑）、赛道包（.rho，游戏格式）或设计文件（.json）。别人的地图要以自己的名义发布，先“另存为”。",
      [["知道了", () => undefined]]);
  }
}
