import { cityContentName } from "../i18n/catalogs/city-content-names";
import { cityDialogueText } from "./city-dialogue";
import { tr } from "../i18n/locale";
/**
 * 卡丁城任务（server-go/CITY-QUESTS.md）：送货、载客、收集、寻物。走到任务点
 * 人物旁按 T 对话：没有任务在身时，人物用故事模式的对话窗口（stage_scene）讲
 * 自己的故事和委托，再用关卡说明窗口（stage_scenarioReady，按类型配原版插图）
 * 列出要做什么、交给谁、限制和报酬，“开始”后节点记下这次任务。收集点和寻物
 * 由节点按位置判定；开到收件人身边（能交付时）就自动交付，节点结算后播放原版
 * “任务成功”动画并显示得到的金币和经验；超速、碰撞太多、超时、乘客不满由节点
 * 判定，播放“任务失败”动画。头顶的金色“！”是有任务可接的人物，“？”是能交付
 * 的收件人，“★”是还没到的收集点。限时任务在画面上方显示原版任务倒计时。
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
import type { CityMapQuest } from "./city-map-window";
import type { CityEvent, CityQuestDone, CityQuestProgress, CityQuestRun } from "./city-protocol";
import { CityQuestMarkers, type QuestMark } from "./city-quest-markers";
import { showQuestResultWindow, type QuestResult } from "./city-quest-result";
import {
  QUEST_BY_ID, QUEST_NPCS, QUEST_RULES, compass, failureResult, failureText, formatDuration, limitShort, limitText,
  offerPages, playerSprite, progressText, questGoal, questLabel, questMarks, questMissionImage, questReady, questsOf,
  rewardText, shortName, npcName, questTitle, questSynopsis, successResult, thanksPages, type QuestDef, type QuestProgress,
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
  /** How high (stage px) the talk balloon up over a task-point NPC stands; 0 without one. */
  balloonHeight?(npcId: string, now: number): number;
  /** The local member sits at the wheel (a passenger quest needs it). */
  isDriving(): boolean;
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
  progress: QuestProgress;
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
const CHAPTER: StoryChapter = { id: 0, name: "kartcity", title: "卡丁城任务", subTitle: "卡丁城",
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
    this.hud.setAttribute("aria-label", tr("卡丁城任务"));
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

  /** The quest under way on the big map: its marks and a search's area. */
  mapMarks(): CityMapQuest | undefined {
    const active = this.active;
    if (!active) return undefined;
    const quest = active.quest;
    const area = quest.type === "search" && !active.progress.found && quest.area
      ? { x: quest.area.x, z: quest.area.z, radius: quest.area.radius, label: tr("寻物范围 · {value0}", { value0: cityContentName(quest.area.name) }) }
      : undefined;
    return { marks: questMarks(quest, active.progress), ...(area ? { area } : {}) };
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
      const quest = active.quest, ready = questReady(quest, active.progress);
      if (npcId === quest.receiver && ready) { void this.deliver(); return; }
      if (npcId === quest.giver) { await this.confirmAbandon(); return; }
      const receiver = shortName(QUEST_NPCS[quest.receiver]);
      this.host.say(npcId, npcId === quest.receiver ? tr("{value0}还没{value1}呢，加油！", { value0: cityContentName(quest.item), value1: quest.type === "collect" ? tr("收齐") : tr("找到") })
        : tr("你还有「{value0}」没做完呢，{value1}在等你！", { value0: questTitle(quest), value1: receiver }));
      return;
    }
    const driving = this.host.isDriving();
    const quest = this.nextQuest(npcId, driving);
    if (!quest) {
      // Only rides are left: they need the member at the wheel.
      if (!driving && questsOf(npcId).length) {
        this.host.say(npcId, tr("你得开着车来接我呀！"));
        this.host.notice(tr("载客任务要坐在驾驶座上才能接。"));
      }
      return;
    }
    this.busy = true;
    this.host.pauseDriving(true);
    try {
      await ensureFeatureResources(this.host.root, "story").catch(() => undefined);
      if (this.disposed) return;
      const emotions = await this.story.loadEmotions();
      const pages = offerPages(quest, { withStory: !this.seenStory.has(npcId), playerName: this.host.playerName(),
        playerSprite: playerSprite(this.host.playerCharacter()) });
      this.seenStory.add(npcId);
      const read = await this.dialogue(pages, emotions, tr("查看委托"));
      if (!read || this.disposed) return;
      const accepted = await this.offer(quest, emotions);
      if (accepted) await this.accept(quest);
    } catch (error) {
      console.warn("送货任务对话失败", error);
      this.host.notice(tr("任务对话打开失败：{value0}", { value0: formatMultiplayerError(error) }));
    } finally {
      this.busy = false;
      if (!this.disposed) this.host.pauseDriving(false);
    }
  }

  /** The NPC's quest least often done here (ties: file order); rides only for a driver. */
  private nextQuest(npcId: string, driving: boolean): QuestDef | undefined {
    const done = loadDone();
    const quests = questsOf(npcId).filter(quest => driving || quest.type !== "passenger");
    return [...quests].sort((a, b) => (done[a.id] ?? 0) - (done[b.id] ?? 0))[0];
  }

  /** Plays dialogue pages in the story window; false when skipped. */
  private dialogue(pages: StoryScenePage[], emotions: Map<string, Map<string, string[]>>, lastLabel: string,
    skipLabel = tr("不了，下次吧")): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let finished = false;
      let view: WindowView | undefined;
      const done = (completed: boolean): void => {
        if (finished) return;
        finished = true;
        if (view) { this.windows.delete(view); view.dispose(); }
        resolve(completed);
      };
      openStoryScene({ library: this.host.library as never, root: this.host.root, chapter: { ...CHAPTER, title: tr(CHAPTER.title), subTitle: tr(CHAPTER.subTitle ?? "") }, pages, emotions,
        lastLabel, skipLabel, onDone: completed => done(completed === true) })
        .then(opened => { view = opened; if (finished) opened.dispose(); else this.windows.add(opened); })
        .catch(reject);
    });
  }

  /** The mission card: what, to whom, the limit and the reward; true when accepted. */
  private async offer(quest: QuestDef, emotions: Map<string, Map<string, string[]>>): Promise<boolean> {
    const receiver = QUEST_NPCS[quest.receiver]!;
    const step: StoryStep = {
      id: 1, title: questTitle(quest), synopsis: questSynopsis(quest),
      howToClear: questGoal(quest),
      missionText: limitShort(quest), readyStage: "", preConditionIds: [], otherWayLockIds: [], isFinalStep: false,
      type: 30, mode: "single", prize: rewardText(quest),
    };
    const mission: StoryMission = { kind: "Delivery", track: "", laps: 1, timeLimitMs: quest.timeLimitMs ?? 0, speed: 7 };
    // The receiver stands where the release shows the track card.
    const portrait = await loadStoryPortrait(this.host.library as never, emotions, receiver.background, receiver.sprite,
      npcName(receiver)).catch(() => undefined);
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
        library: this.host.library as never, root: this.host.root, chapter: { ...CHAPTER, title: tr(CHAPTER.title), subTitle: tr(CHAPTER.subTitle ?? "") }, step, mission,
        trackTitle: npcName(receiver), cleared: false, badgeText: questLabel(quest), missionImage: questMissionImage(quest),
        startLabel: tr("接受任务"), closeLabel: tr("再想想"), playable: true, portrait,
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
      this.active = { quest, run, collisions: run.collisions, delivering: false, triedAt: 0,
        progress: { collected: run.collected, found: run.found, signal: run.signal, satisfaction: run.satisfaction } };
      if (quest.type !== "passenger") this.host.say(quest.giver, tr("拜托你啦，路上小心！"));
      this.host.notice(acceptText(quest));
      if (quest.kind === "time") void this.loadTimer();
      void this.loadAction();
    } catch (error) {
      this.host.notice(tr("接任务失败：{value0}", { value0: questError(error) }));
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
      openStoryConfirm({ library: this.host.library as never, root: this.host.root, title: tr("放弃任务"),
        message: tr("要放弃「{value0}」吗？放弃后没有报酬。", { value0: questTitle(active.quest) }), yes: tr("放弃任务"), no: tr("继续任务"),
        onYes: () => finish(true), onNo: () => finish(false) })
        .then(opened => { view = opened; if (settled) opened.dispose(); else this.windows.add(opened); })
        .catch(reject);
    }).finally(() => { this.busy = false; });
    if (!yes || this.active !== active) return;
    try {
      await this.host.network()?.abandonQuest();
      this.clear();
      this.host.notice(tr("已放弃任务「{value0}」。", { value0: questTitle(active.quest) }));
    } catch (error) {
      this.host.notice(tr("放弃失败：{value0}", { value0: questError(error) }));
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
      if (active.quest.type !== "passenger") this.host.say(active.quest.receiver, cityDialogueText(active.quest.thanks));
      this.showResult(true);
      await this.celebrate(active.quest, done);
    } catch (error) {
      active.delivering = false;
      const code = (error as { code?: string })?.code;
      // A pose a frame behind is still "too far": the next update tries again.
      if (code !== "TOO_FAR") this.host.notice(tr("交付失败：{value0}", { value0: questError(error) }));
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
      await this.dialogue(thanksPages(quest), emotions, tr("领取报酬"), tr("领取报酬"));
      await this.resultWindow(successResult(quest, done));
    } catch (error) {
      console.warn("任务结算窗口失败", error);
      this.host.notice(tr("「{value0}」完成！获得 金币 {value1}、经验 {value2}。", { value0: questTitle(quest), value1: done.lucci, value2: done.exp }));
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
      if (active && event.quest === active.quest.id) this.progressed(active, event);
      return;
    }
    if (event.type !== "city-quest-failed") return;
    const quest = QUEST_BY_ID.get(event.quest);
    if (active && active.quest.id === event.quest) this.clear();
    this.showResult(false);
    this.host.notice(tr("任务失败：{value0}", { value0: failureText(quest, event.reason) }));
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

  /** What a city-quest-progress changed, told to the player. */
  private progressed(active: Active, event: CityQuestProgress): void {
    const quest = active.quest, before = active.progress;
    const collided = event.collisions > active.collisions;
    active.collisions = event.collisions;
    active.progress = { collected: event.collected ?? before.collected, found: event.found ?? before.found,
      signal: event.signal ?? before.signal, satisfaction: event.satisfaction ?? before.satisfaction };
    if (collided && quest.kind === "collision") {
      const left = (quest.maxCollisions ?? 0) - event.collisions;
      const what = quest.type === "passenger" ? cityContentName(quest.item) : tr("货物");
      this.host.notice(left > 0 ? tr("小心！碰撞 {value0}/{value1} 次，再撞 {value2} 次{value3}就受不了了。", { value0: event.collisions, value1: quest.maxCollisions ?? 0, value2: left + 1, value3: what })
        : tr("碰撞已经 {value0}/{value1} 次，不能再撞了！", { value0: event.collisions, value1: quest.maxCollisions ?? 0 }));
    }
    if (quest.type === "passenger" && event.satisfaction !== undefined && before.satisfaction !== undefined) {
      // A complaint for a collision, and each time the mood drops past a step of 20.
      const step = (value: number) => Math.floor(value / 20);
      if (collided && quest.kind !== "collision") this.host.notice(tr("{value0}：哎哟！慢点开～（满意度 {value1}%）", { value0: cityContentName(quest.item), value1: event.satisfaction }));
      else if (step(event.satisfaction) < step(before.satisfaction))
        this.host.notice(tr("{value0}：开太快啦，我有点怕……（满意度 {value1}%）", { value0: cityContentName(quest.item), value1: event.satisfaction }));
    }
    if (quest.type === "collect" && event.collected) {
      const got = event.collected.filter(Boolean).length;
      const was = before.collected?.filter(Boolean).length ?? 0;
      if (got > was) {
        const stop = quest.stops?.find((_, i) => event.collected![i] && !before.collected?.[i]);
        this.host.notice(got >= event.collected.length
          ? tr("收齐了！把{value0}交给{value1}。", { value0: cityContentName(quest.item), value1: npcName(QUEST_NPCS[quest.receiver]) })
          : tr("拿到了「{value0}」（{value1}/{value2}）。", { value0: cityContentName(stop?.name ?? quest.item), value1: got, value2: event.collected.length }));
      }
    }
    if (quest.type === "search" && event.found && !before.found)
      this.host.notice(tr("找到{value0}了！把它交给{value1}。", { value0: cityContentName(quest.item), value1: npcName(QUEST_NPCS[quest.receiver]) }));
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
    // Arriving (once the quest can be finished) hands it over.
    if (active && here && !active.delivering && now - active.triedAt > 800 && questReady(active.quest, active.progress)) {
      const receiver = QUEST_NPCS[active.quest.receiver]!;
      if (Math.hypot(receiver.x - here.x, receiver.z - here.z) <= QUEST_RULES.arriveRadius) void this.deliver();
    }
    // The timer and the line under the status bar.
    let text = "";
    if (active) {
      const quest = active.quest;
      const parts = [hudHead(quest, active.progress)];
      const goal = hudGoal(quest, active.progress, here);
      if (goal && here) parts.push(`${compass(here.x, here.z, goal.x, goal.z)} ${Math.round(Math.hypot(goal.x - here.x, goal.z - here.z))} m`);
      const status = progressText(quest, active.progress);
      if (status) parts.push(status);
      if (quest.kind === "speed" && local) {
        const kmh = Math.round(local.speed * 3.6);
        parts.push(kmh > (quest.maxKmh ?? 0) ? tr("⚠ 超速！{value0}/{value1} km/h", { value0: kmh, value1: quest.maxKmh ?? 0 }) : tr("车速 {value0}/{value1} km/h", { value0: kmh, value1: quest.maxKmh ?? 0 }));
      }
      if (quest.kind === "collision") parts.push(tr("碰撞 {value0}/{value1}", { value0: active.collisions, value1: quest.maxCollisions ?? 0 }));
      if (quest.kind === "time") {
        const left = Math.max(0, active.run.deadline - this.host.serverNow());
        this.timer?.set(left);
        parts.push(tr("剩余 {value0}", { value0: formatDuration(left) }));
      }
      text = parts.join(" · ");
    } else if (this.nearest && !this.windowOpen) {
      text = tr("T 与{value0}对话", { value0: shortName(QUEST_NPCS[this.nearest]) });
    }
    if (text !== this.lastHud) {
      this.lastHud = text;
      this.hud.textContent = text;
      this.hud.style.display = text ? "" : "none";
      // The release mission timer (missionTimer.bml) takes the top centre; the line goes under it.
      this.hud.style.top = active?.quest.kind === "time" ? "104px" : "48px";
    }
    // The marks over the NPCs' heads and over the collection stops.
    const marks: Array<{ mark: QuestMark; tagless?: boolean; balloon?: number } & Vec3> = [];
    const balloon = (npcId: string) => this.host.balloonHeight?.(npcId, now) ?? 0;
    if (active) {
      for (const mark of questMarks(active.quest, active.progress)) {
        if (mark.npc) marks.push({ mark: mark.mark, balloon: balloon(mark.npc), ...(this.host.npcFeet(mark.npc) ?? npcWorld(mark.npc)) });
        else marks.push({ mark: mark.mark, tagless: true, ...designToWorld(mark.x, mark.y ?? 10, mark.z) });
      }
    } else {
      for (const id of Object.keys(QUEST_NPCS)) {
        if (!questsOf(id).length) continue;
        const feet = this.host.npcFeet(id);
        if (feet) marks.push({ mark: "!", balloon: balloon(id), ...feet });
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

/** The HUD line's start: the quest's type, what and to whom. */
function hudHead(quest: QuestDef, progress: QuestProgress): string {
  const receiver = npcName(QUEST_NPCS[quest.receiver]);
  switch (quest.type) {
    case "passenger": return tr("载客：{value0} → {value1}", { value0: cityContentName(quest.item), value1: receiver });
    case "collect": return questReady(quest, progress) ? tr("收集：{value0} → {value1}", { value0: cityContentName(quest.item), value1: receiver }) : tr("收集：{value0}", { value0: cityContentName(quest.item) });
    case "search": return progress.found ? tr("寻物：{value0} → {value1}", { value0: cityContentName(quest.item), value1: receiver }) : tr("寻物：{value0} · {value1}", { value0: cityContentName(quest.item), value1: cityContentName(quest.area?.name ?? "") });
    default: return tr("送货：{value0} → {value1}", { value0: cityContentName(quest.item), value1: receiver });
  }
}

/** Where the HUD points: the nearest stop still to reach, a search's area until found, else the receiver. */
function hudGoal(quest: QuestDef, progress: QuestProgress, here: { x: number; z: number } | undefined):
  { x: number; z: number } | undefined {
  if (quest.type === "collect" && !questReady(quest, progress) && here) {
    let best: { x: number; z: number } | undefined, bestD = Infinity;
    quest.stops?.forEach((stop, i) => {
      const d = Math.hypot(stop.x - here.x, stop.z - here.z);
      if (!progress.collected?.[i] && d < bestD) { bestD = d; best = stop; }
    });
    return best;
  }
  if (quest.type === "search" && !progress.found && quest.area && here) {
    // Inside the area the signal guides; outside it, the way there.
    return Math.hypot(quest.area.x - here.x, quest.area.z - here.z) > quest.area.radius ? quest.area : undefined;
  }
  return QUEST_NPCS[quest.receiver];
}

/** The notice when a quest is accepted. */
function acceptText(quest: QuestDef): string {
  const receiver = npcName(QUEST_NPCS[quest.receiver]);
  const limit = quest.kind === "normal" ? "" : `${limitText(quest)}。`;
  switch (quest.type) {
    case "passenger":
      return tr("接受载客任务「{value0}」：{value1}上车了，送到{value2}那里。{value3}开得平稳，乘客满意会给小费。", { value0: questTitle(quest), value1: cityContentName(quest.item), value2: receiver, value3: limit });
    case "collect":
      return tr("接受收集任务「{value0}」：到地图上标“★”的 {value1} 个地方收集{value2}，再交给{value3}。{value4}", { value0: questTitle(quest), value1: quest.stops?.length ?? 0, value2: cityContentName(quest.item), value3: receiver, value4: limit });
    case "search":
      return tr("接受寻物任务「{value0}」：{value1}在{value2}，靠得越近信号越强（M 地图上的圆圈是搜索范围）。{value3}", { value0: questTitle(quest), value1: cityContentName(quest.item), value2: cityContentName(quest.area?.name ?? tr("附近")), value3: limit });
    default:
      return tr("接受送货任务「{value0}」：把{value1}送到{value2}。{value3}", { value0: questTitle(quest), value1: cityContentName(quest.item), value2: receiver, value3: limit });
  }
}

function questError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case "TOO_FAR": return tr("离人物太远了，再靠近一点。");
    case "QUEST_ACTIVE": return tr("你已经有一个任务了。");
    case "PASSENGER": return tr("坐在后座不能接任务。");
    case "NOT_DRIVING": return tr("载客任务要坐在驾驶座上才能接。");
    case "SEAT_TAKEN": return tr("后座已经有人了，载不了乘客。");
    case "NOT_COLLECTED": return tr("还没收集齐。");
    case "NOT_FOUND": return tr("还没找到东西。");
    case "CITY_QUESTS_OFF": return tr("城市任务暂时关闭。");
    case "NO_QUEST": return tr("现在没有任务。");
    case "QUEST_FAILED": return tr("任务已经失败了。");
  }
  return formatMultiplayerError(error);
}
