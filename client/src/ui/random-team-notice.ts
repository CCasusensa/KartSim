import { tr } from "../i18n/locale";
import { te } from "../generated/library.js";
import { node, nodeName, type BmlLibrary, type Node, type Rect, type WindowView } from "./bml-kit";
import { paintRandomTeamBanner } from "./random-team-art";

/**
 * 隊伍隨機分配! — the banner shown to every racer when a team race whose
 * host switched the random deal on starts (`race.randomTeam`), before the
 * loading screen, like the 挡人 mission banner. Drawn by the release
 * window renderer on a full-stage panel; the art is canvas-only.
 */

export const RANDOM_TEAM_NOTICE_MS = 2600;

export function randomTeamNoticeDefinition(): Node {
  return node("Container", { windowRect: "fullscreen" }, [
    node("Panel", { name: "randomTeamBand", leftTopWH: "0 330 1600 180" }),
  ]);
}

/** The banner's progress 0…1 after `elapsed` ms, or undefined once it is over. */
export function randomTeamNoticeProgress(elapsed: number): number | undefined {
  return elapsed >= RANDOM_TEAM_NOTICE_MS ? undefined : Math.max(0, elapsed) / RANDOM_TEAM_NOTICE_MS;
}

interface NoticeView extends WindowView { hide(): void }

export interface RandomTeamNoticeDependencies {
  nowMs(): number;
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(id: number): void;
}

const browserDependencies: RandomTeamNoticeDependencies = {
  nowMs: () => performance.now(),
  requestFrame: callback => requestAnimationFrame(callback),
  cancelFrame: id => cancelAnimationFrame(id),
};

export class RandomTeamNotice {
  view!: NoticeView;
  since = 0;
  animation?: number;
  cancel?: () => void;
  complete?: (error?: unknown) => void;
  disposed = false;
  started = false;

  constructor(readonly dependencies: RandomTeamNoticeDependencies = browserDependencies) {}

  static async load(library: BmlLibrary, root: HTMLElement, race: { randomTeam?: boolean },
    _playerId: string, dependencies: RandomTeamNoticeDependencies = browserDependencies,
    loadView: (options: Record<string, unknown>) => Promise<unknown> = options => te.load(options as never)):
    Promise<RandomTeamNotice> {
    if (!race.randomTeam) throw new Error("本局没有队伍随机分配。");
    const notice = new RandomTeamNotice(dependencies);
    notice.view = await loadView({
      library, root, definition: randomTeamNoticeDefinition(), roots: ["stage_/mqReady", "stage_/common"],
      label: tr("队伍随机分配"), preserveDisplayPixels: true, smoothImages: true,
      state: (entry: Node) => nodeName(entry) === "randomTeamBand" ? {
        paint: (context: CanvasRenderingContext2D, rect: Rect) => {
          const progress = randomTeamNoticeProgress(dependencies.nowMs() - notice.since);
          if (progress !== undefined) paintRandomTeamBanner(context, rect, progress);
        },
      } : {},
    }) as NoticeView;
    notice.view.element.dataset.uiLayer = "notice";
    notice.view.element.style.pointerEvents = "none";
    return notice;
  }

  /** Show the banner for its whole life; the signal cuts it short. */
  present(signal: AbortSignal): Promise<void> {
    if (this.disposed || signal.aborted) return Promise.reject(new Error("队伍随机分配展示已取消。"));
    if (this.started) throw new Error("队伍随机分配展示不能重复开始。");
    this.started = true;
    this.since = this.dependencies.nowMs();
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => this.finish(new Error("队伍随机分配展示已取消。"));
      this.cancel = () => signal.removeEventListener("abort", onAbort);
      this.complete = error => error ? reject(error) : resolve();
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        this.view.show();
        this.animation = this.dependencies.requestFrame(() => this.update());
      } catch (error) {
        this.finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  update(): void {
    if (!this.complete || this.disposed) return;
    try {
      if (randomTeamNoticeProgress(this.dependencies.nowMs() - this.since) === undefined) {
        this.finish();
        return;
      }
      this.view.render();
      this.animation = this.dependencies.requestFrame(() => this.update());
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(String(error)));
    }
  }

  finish(error?: unknown): void {
    if (this.animation !== undefined) this.dependencies.cancelFrame(this.animation);
    this.animation = undefined;
    this.cancel?.();
    this.cancel = undefined;
    this.view.hide();
    const complete = this.complete;
    this.complete = undefined;
    complete?.(error);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finish(new Error("队伍随机分配展示已释放。"));
    this.view.dispose();
  }
}
