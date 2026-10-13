/**
 * 卡丁城送货任务（server-go/CITY-QUESTS.md）。走到任务点人物旁按 T 对话：
 * 没有任务在身时，人物用故事模式的对话窗口（stage_scene）讲自己的故事和委托，
 * 再用关卡说明窗口（stage_scenarioReady，原版“配送”插图）列出送什么、送给谁、
 * 限制和报酬，“接受任务”后节点记下这次送货。把货开到收件人身边就自动交付，
 * 节点结算后播放原版“任务成功”动画并显示得到的金币和经验；超速、碰撞太多、
 * 超时由节点判定，播放“任务失败”动画。头顶的金色“！”是有任务可接的人物，
 * “？”是这次送货的收件人。限时任务在画面上方显示原版任务倒计时。
 */
import type { PerspectiveCamera, WebGLRenderer } from "three";
import { MissionTimerPanel } from "../license/mission-timer-panel";
import { MissionResultAction } from "../story/mission-result-action";
import type { StoryChapter, StoryMission, StoryScenePage, StoryStep } from "../story/story-data";
import { StoryResources } from "../story/story-resources";
import { ensureFeatureResources } from "../ui/resource-panel";
import { loadStoryPortrait, openStoryConfirm, openStoryReady, openStoryScene } from "../ui/story-windows";
import { formatMultiplayerError } from "../multiplayer/errors";
import type { CityNetwork } from "./city-connection";
import { designToWorld, worldToDesign } from "./city-coordinates";
import type { CityEvent, CityQuestDone, CityQuestRun } from "./city-protocol";
import { CityQuestMarkers, type QuestMark } from "./city-quest-markers";
import { showQuestResultWindow, type QuestResult } from "./city-quest-result";
import {
  QUEST_BY_ID, QUEST_NPCS, QUEST_RULES, compass, failureResult, failureText, formatDuration, limitShort, limitText,
  offerPages, playerSprite, questsOf, rewardText, shortName, successResult, thanksPages, type QuestDef,
} from "./city-quest-data";

interface Vec3 { x: number; y: number; z: number }
interface WindowView { dispose(): void; disposed: boolean }

export interface CityQuestHost {
  root: HTMLElement;
  library: unknown;
  camera(): PerspectiveCamera;
  renderer(): WebGLRenderer;
  network(): CityNetwork | undefined;
  /** Node time now (ms). */
  serverNow(): number;
  /** The local rider (its kart, or itself on foot) and its speed (m/s); undefined on a back seat. */
  local(): { position: Vec3; speed: number } | undefined;
  /** A task-point NPC's feet (world), once its figure stands. */
  npcFeet(id: string): Vec3 | undefined;
  /** A talk balloon over a task-point NPC. */
  say(npcId: string, text: string): void;
  notice(text: string): void;
  playerName(): string;
  playerCharacter(): number | undefined;
  /** Driving pauses while a quest window is open. */
  pauseDriving(paused: boolean): void;
  audioContext(): AudioContext | undefined;
}

interface Active {
  quest: QuestDef;
  run: CityQuestRun;
  collisions: number;
  delivering: boolean;
  /** When delivery was last tried (TOO_FAR from a stale pose retries). */
  triedAt: number;
}

const DONE_KEY = "kartsim.city.questsDone";
/**
 * The mission result plays without the race's FINISH lead-in, about 2.4 s on
 * screen, its banner in the middle of the screen and larger.
 */
const RESULT_TIMING = { skipMs: 1900, holdMs: 1300,
  // The 成功 / 失败 lettering sits left of and above its mesh's centre.
  framing: { centre: true, scale: 1.8, nudge: { x: 50, y: 26 } } };
/** The windows after it open once it has played. */
const RESULT_WAIT_MS = 2500;
const CHAPTER: StoryChapter = { id: 0, name: "kartcity", title: "卡丁城送货任务", subTitle: "卡丁城",
  desc: "", regular: false, showNew: false };

function loadDone(): Record<string, number> {
  try { return JSON.parse(globalThis.localStorage?.getItem(DONE_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

function saveDone(done: Record<string, number>): void {
  try { globalThis.localStorage?.setItem(DONE_KEY, JSON.stringify(done)); } catch { /* private mode */ }
}

export class CityQuests {
  active?: Active;
  disposed = false;
  private windows = new Set<WindowView>();
  private busy = false;
  private readonly markers: CityQuestMarkers;
  private readonly hud: HTMLDivElement;
  private readonly story: StoryResources;
  private readonly seenStory = new Set<string>();
  private timer?: MissionTimerPanel;
  private action?: MissionResultAction;
  private actionLoading?: Promise<MissionResultAction | undefined>;
  private lastHud = "";
  private nearest?: string;

  constructor(readonly host: CityQuestHost) {
    this.markers = new CityQuestMarkers(host.root);
    this.story = new StoryResources(host.library as never);
    this.hud = document.createElement("div");
    this.hud.className = "kartcity-quest";
    this.hud.setAttribute("aria-label", "送货任务");
    Object.assign(this.hud.style, {
      position: "absolute", left: "50%", top: "48px", transform: "translateX(-50%)", padding: "4px 14px",
      borderRadius: "14px", background: "rgba(40, 24, 4, 0.62)", color: "#ffe9a8",
      font: "bold 15px 'PingFang SC', 'Microsoft YaHei', sans-serif", letterSpacing: "0.5px",
      pointerEvents: "none", zIndex: "4", whiteSpace: "nowrap", display: "none",
    });
    host.root.append(this.hud);
  }

  /** A quest window is open (keys and chat belong to it). */
  get windowOpen(): boolean { return this.busy || this.windows.size > 0; }

  /** The task-point NPC within talking range, if any. */
  nearbyNpc(): string | undefined { return this.nearest; }

  /** The M map covers the view: the delivery line steps aside. */
  cover(covered: boolean): void {
    const visibility = covered ? "hidden" : "";
    if (this.hud.style.visibility !== visibility) this.hud.style.visibility = visibility;
  }

  /** Where the delivery under way goes (design x/z), for the big map. */
  target(): { x: number; z: number; label: string } | undefined {
    const quest = this.active?.quest;
    const receiver = quest && QUEST_NPCS[quest.receiver];
    return receiver && { x: receiver.x, z: receiver.z, label: `送货目标 · ${receiver.name}` };
  }

  // ---- keys ----

  /** T talks to the NPC nearby; true when the key was used. */
  keydown(event: KeyboardEvent): boolean {
    if (event.code !== "KeyT" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
    const npc = this.nearest;
    if (!npc || this.windowOpen) return false;
    event.preventDefault();
    void this.talk(npc);
    return true;
  }

  private async talk(npcId: string): Promise<void> {
    const active = this.active;
    if (active) {
      if (npcId === active.quest.receiver) { void this.deliver(); return; }
      if (npcId === active.quest.giver) { await this.confirmAbandon(); return; }
      this.host.say(npcId, `你还有「${active.quest.item}」要送给${shortName(QUEST_NPCS[active.quest.receiver])}呢，先去送货吧！`);
      return;
    }
    const quest = this.nextQuest(npcId);
    if (!quest) return;
    this.busy = true;
    this.host.pauseDriving(true);
    try {
      await ensureFeatureResources(this.host.root, "story").catch(() => undefined);
      if (this.disposed) return;
      const emotions = await this.story.loadEmotions();
      const pages = offerPages(quest, { withStory: !this.seenStory.has(npcId), playerName: this.host.playerName(),
        playerSprite: playerSprite(this.host.playerCharacter()) });
      this.seenStory.add(npcId);
      const read = await this.dialogue(pages, emotions, "查看委托");
      if (!read || this.disposed) return;
      const accepted = await this.offer(quest, emotions);
      if (accepted) await this.accept(quest);
    } catch (error) {
      console.warn("送货任务对话失败", error);
      this.host.notice(`任务对话打开失败：${formatMultiplayerError(error)}`);
    } finally {
      this.busy = false;
      if (!this.disposed) this.host.pauseDriving(false);
    }
  }

  /** The NPC's quest least often delivered here (ties: file order). */
  private nextQuest(npcId: string): QuestDef | undefined {
    const done = loadDone();
    const quests = questsOf(npcId);
    return [...quests].sort((a, b) => (done[a.id] ?? 0) - (done[b.id] ?? 0))[0];
  }

  /** Plays dialogue pages in the story window; false when skipped. */
  private dialogue(pages: StoryScenePage[], emotions: Map<string, Map<string, string[]>>, lastLabel: string,
    skipLabel = "不了，下次吧"): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let finished = false;
      let view: WindowView | undefined;
      const done = (completed: boolean): void => {
        if (finished) return;
        finished = true;
        if (view) { this.windows.delete(view); view.dispose(); }
        resolve(completed);
      };
      openStoryScene({ library: this.host.library as never, root: this.host.root, chapter: CHAPTER, pages, emotions,
        lastLabel, skipLabel, onDone: completed => done(completed === true) })
        .then(opened => { view = opened; if (finished) opened.dispose(); else this.windows.add(opened); })
        .catch(reject);
    });
  }

  /** The mission card: what, to whom, the limit and the reward; true when accepted. */
  private async offer(quest: QuestDef, emotions: Map<string, Map<string, string[]>>): Promise<boolean> {
    const receiver = QUEST_NPCS[quest.receiver]!;
    const step: StoryStep = {
      id: 1, title: quest.title, synopsis: quest.synopsis,
      howToClear: `${quest.item} → ${shortName(receiver)}（约 ${(quest.distanceM / 1000).toFixed(1)} km）`,
      missionText: limitShort(quest), readyStage: "", preConditionIds: [], otherWayLockIds: [], isFinalStep: false,
      type: 30, mode: "single", prize: rewardText(quest),
    };
    const mission: StoryMission = { kind: "Delivery", track: "", laps: 1, timeLimitMs: quest.timeLimitMs ?? 0, speed: 7 };
    // The receiver stands where the release shows the track card.
    const portrait = await loadStoryPortrait(this.host.library as never, emotions, receiver.background, receiver.sprite,
      receiver.name).catch(() => undefined);
    return new Promise((resolve, reject) => {
      let view: WindowView | undefined;
      let settled = false;
      const finish = (accepted: boolean): void => {
        if (settled) return;
        settled = true;
        if (view) { this.windows.delete(view); view.dispose(); }
        resolve(accepted);
      };
      openStoryReady({
        library: this.host.library as never, root: this.host.root, chapter: CHAPTER, step, mission,
        trackTitle: receiver.name, cleared: false, badgeText: QUEST_RULES.kinds[quest.kind].label,
        startLabel: "接受任务", closeLabel: "再想想", playable: true, portrait,
        onStart: () => finish(true), onClose: () => finish(false),
      }).then(opened => {
        view = opened;
        if (settled) opened.dispose(); else this.windows.add(opened);
      }).catch(reject);
    });
  }

  private async accept(quest: QuestDef): Promise<void> {
    const network = this.host.network();
    if (!network) return;
    try {
      const run = await network.acceptQuest(quest.id);
      if (this.disposed) return;
      this.active = { quest, run, collisions: run.collisions, delivering: false, triedAt: 0 };
      const receiver = QUEST_NPCS[quest.receiver]!;
      this.host.say(quest.giver, "拜托你啦，路上小心！");
      this.host.notice(`接受送货任务「${quest.title}」：把${quest.item}送到${receiver.name}。${limitText(quest)}。`);
      if (quest.kind === "time") void this.loadTimer();
      void this.loadAction();
    } catch (error) {
      this.host.notice(`接任务失败：${questError(error)}`);
    }
  }

  private async confirmAbandon(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.busy = true;
    const yes = await new Promise<boolean>((resolve, reject) => {
      let view: WindowView | undefined;
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        if (view) { this.windows.delete(view); view.dispose(); }
        resolve(value);
      };
      openStoryConfirm({ library: this.host.library as never, root: this.host.root, title: "放弃送货",
        message: `要放弃「${active.quest.title}」吗？放弃后没有报酬。`, yes: "放弃任务", no: "继续送货",
        onYes: () => finish(true), onNo: () => finish(false) })
        .then(opened => { view = opened; if (settled) opened.dispose(); else this.windows.add(opened); })
        .catch(reject);
    }).finally(() => { this.busy = false; });
    if (!yes || this.active !== active) return;
    try {
      await this.host.network()?.abandonQuest();
      this.clear();
      this.host.notice(`已放弃送货任务「${active.quest.title}」。`);
    } catch (error) {
      this.host.notice(`放弃失败：${questError(error)}`);
    }
  }

  // ---- delivery ----

  private async deliver(): Promise<void> {
    const active = this.active;
    const network = this.host.network();
    if (!active || active.delivering || !network) return;
    active.delivering = true;
    active.triedAt = performance.now();
    try {
      const done = await network.deliverQuest();
      if (this.disposed || this.active !== active) return;
      this.clear();
      const record = loadDone();
      record[active.quest.id] = (record[active.quest.id] ?? 0) + 1;
      saveDone(record);
      this.host.say(active.quest.receiver, active.quest.thanks);
      this.showResult(true);
      await this.celebrate(active.quest, done);
    } catch (error) {
      active.delivering = false;
      const code = (error as { code?: string })?.code;
      // A pose a frame behind is still "too far": the next update tries again.
      if (code !== "TOO_FAR") this.host.notice(`交付失败：${questError(error)}`);
    }
  }

  /** After the success animation: the receiver's thanks and what was earned. */
  private async celebrate(quest: QuestDef, done: CityQuestDone): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, RESULT_WAIT_MS));
    if (this.disposed) return;
    this.busy = true;
    this.host.pauseDriving(true);
    try {
      await ensureFeatureResources(this.host.root, "story").catch(() => undefined);
      const emotions = await this.story.loadEmotions();
      await this.dialogue(thanksPages(quest), emotions, "领取报酬", "领取报酬");
      await this.resultWindow(successResult(quest, done));
    } catch (error) {
      console.warn("送货结算窗口失败", error);
      this.host.notice(`「${quest.title}」完成！获得 金币 ${done.lucci}、经验 ${done.exp}。`);
    } finally {
      this.busy = false;
      if (!this.disposed) this.host.pauseDriving(false);
    }
  }

  /** The 任务成功 / 任务失败 window; resolves when it closes. */
  private resultWindow(result: QuestResult): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let view: WindowView | undefined;
      let settled = false;
      const close = (): void => {
        if (settled) return;
        settled = true;
        if (view) { this.windows.delete(view); view.dispose(); }
        resolve();
      };
      showQuestResultWindow({ library: this.host.library as never, root: this.host.root }, result, close)
        .then(opened => { view = opened; if (settled) opened.dispose(); else this.windows.add(opened); })
        .catch(reject);
    });
  }

  onEvent(event: CityEvent): void {
    const active = this.active;
    if (event.type === "city-quest-progress") {
      if (active && event.quest === active.quest.id) {
        active.collisions = event.collisions;
        const left = (active.quest.maxCollisions ?? 0) - event.collisions;
        this.host.notice(left > 0 ? `小心！碰撞 ${event.collisions}/${active.quest.maxCollisions} 次，再撞 ${left + 1} 次货物就坏了。`
          : `碰撞已经 ${event.collisions}/${active.quest.maxCollisions} 次，不能再撞了！`);
      }
      return;
    }
    if (event.type !== "city-quest-failed") return;
    const quest = QUEST_BY_ID.get(event.quest);
    if (active && active.quest.id === event.quest) this.clear();
    this.showResult(false);
    this.host.notice(`任务失败：${failureText(quest, event.reason)}`);
    void this.explainFailure(failureResult(quest, event.reason, event.collisions));
  }

  private async explainFailure(result: QuestResult): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, RESULT_WAIT_MS));
    if (this.disposed || this.windowOpen) return;
    this.busy = true;
    try {
      await this.resultWindow(result);
    } catch (error) {
      console.warn("任务失败窗口打开失败", error);
    } finally {
      this.busy = false;
    }
  }

  private clear(): void {
    this.active = undefined;
    this.timer?.set(undefined);
  }

  // ---- the mission result and timer (release assets) ----

  private loadAction(): Promise<MissionResultAction | undefined> {
    if (this.action) return Promise.resolve(this.action);
    const context = this.host.audioContext();
    if (!context) return Promise.resolve(undefined);
    this.actionLoading ??= MissionResultAction.load(this.host.library, context).then(action => {
      if (this.disposed) { action.dispose(); return undefined; }
      this.action = action;
      return action;
    }).catch(error => {
      console.warn("任务成功/失败动画载入失败", error);
      this.actionLoading = undefined;
      return undefined;
    });
    return this.actionLoading;
  }

  private async loadTimer(): Promise<void> {
    if (this.timer) return;
    try {
      const timer = await MissionTimerPanel.load(this.host.library as never);
      if (this.disposed) { timer.dispose(); return; }
      this.timer = timer;
    } catch (error) {
      console.warn("任务倒计时载入失败", error);
    }
  }

  private showResult(success: boolean): void {
    void this.loadAction().then(action => action?.show(success, performance.now(), RESULT_TIMING));
  }

  // ---- per frame ----

  update(now: number): void {
    if (this.disposed) return;
    const local = this.host.local();
    const here = local ? worldToDesign(local.position.x, local.position.y, local.position.z) : undefined;
    // The NPC to talk to.
    this.nearest = undefined;
    if (here) {
      let best = QUEST_RULES.talkRadius;
      for (const [id, npc] of Object.entries(QUEST_NPCS)) {
        const d = Math.hypot(npc.x - here.x, npc.z - here.z);
        if (d <= best) { best = d; this.nearest = id; }
      }
    }
    const active = this.active;
    // Arriving hands the item over.
    if (active && here && !active.delivering && now - active.triedAt > 800) {
      const receiver = QUEST_NPCS[active.quest.receiver]!;
      if (Math.hypot(receiver.x - here.x, receiver.z - here.z) <= QUEST_RULES.arriveRadius) void this.deliver();
    }
    // The timer and the line under the status bar.
    let text = "";
    if (active) {
      const quest = active.quest, receiver = QUEST_NPCS[quest.receiver]!;
      const parts = [`送货：${quest.item} → ${receiver.name}`];
      if (here) parts.push(`${compass(here.x, here.z, receiver.x, receiver.z)} ${Math.round(Math.hypot(receiver.x - here.x, receiver.z - here.z))} m`);
      if (quest.kind === "speed" && local) {
        const kmh = Math.round(local.speed * 3.6);
        parts.push(kmh > (quest.maxKmh ?? 0) ? `⚠ 超速！${kmh}/${quest.maxKmh} km/h` : `车速 ${kmh}/${quest.maxKmh} km/h`);
      }
      if (quest.kind === "collision") parts.push(`碰撞 ${active.collisions}/${quest.maxCollisions}`);
      if (quest.kind === "time") {
        const left = Math.max(0, active.run.deadline - this.host.serverNow());
        this.timer?.set(left);
        parts.push(`剩余 ${formatDuration(left)}`);
      }
      text = parts.join(" · ");
    } else if (this.nearest && !this.windowOpen) {
      text = `T 与${shortName(QUEST_NPCS[this.nearest])}对话`;
    }
    if (text !== this.lastHud) {
      this.lastHud = text;
      this.hud.textContent = text;
      this.hud.style.display = text ? "" : "none";
      // The release mission timer (missionTimer.bml) takes the top centre; the line goes under it.
      this.hud.style.top = active?.quest.kind === "time" ? "104px" : "48px";
    }
    // The marks over the NPCs' heads.
    const marks: Array<{ mark: QuestMark } & Vec3> = [];
    if (active) {
      const feet = this.host.npcFeet(active.quest.receiver) ?? npcWorld(active.quest.receiver);
      marks.push({ mark: "?", ...feet });
    } else {
      for (const id of Object.keys(QUEST_NPCS)) {
        if (!questsOf(id).length) continue;
        const feet = this.host.npcFeet(id);
        if (feet) marks.push({ mark: "!", ...feet });
      }
    }
    this.markers.draw(this.host.camera(), this.windowOpen ? [] : marks, now);
  }

  /** Draws the timer and the mission result over the frame just rendered. */
  render(now: number): void {
    if (this.disposed) return;
    const renderer = this.host.renderer();
    const canvas = renderer.domElement;
    if (this.active?.quest.kind === "time") this.timer?.render(renderer, now, canvas.width, canvas.height);
    this.action?.render(renderer, now);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const view of this.windows) view.dispose();
    this.windows.clear();
    this.markers.dispose();
    this.hud.remove();
    this.timer?.dispose();
    this.action?.dispose();
  }
}

/** Where an NPC stands (world), before its figure is loaded: at its spot. */
function npcWorld(id: string): Vec3 {
  const npc = QUEST_NPCS[id]!;
  return designToWorld(npc.x, 10, npc.z);
}

function questError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case "TOO_FAR": return "离人物太远了，再靠近一点。";
    case "QUEST_ACTIVE": return "你已经有一个送货任务了。";
    case "PASSENGER": return "坐在后座不能接送货任务。";
    case "CITY_QUESTS_OFF": return "送货任务暂时关闭。";
    case "NO_QUEST": return "现在没有送货任务。";
    case "QUEST_FAILED": return "任务已经失败了。";
  }
  return formatMultiplayerError(error);
}
