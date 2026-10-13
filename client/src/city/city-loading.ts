import { RaceLoadingScreen } from "../multiplayer/race-loading-screen";
import { currentResourceManager } from "../resources/resource-manager";

interface CityLoadingView {
  showStatus(message: string): void;
  dispose(): void;
}
interface CityLoadingResources {
  subscribe(listener: () => void): () => void;
  trackContainers(track: string): string[];
  bytesOf(containers: Iterable<string>): number;
  bytesDone(containers: readonly string[]): number;
}
export interface CityLoadingHost {
  disposed: boolean;
  options: {
    library: unknown;
    root: unknown;
    cityLoading?: CityLoadingHandle;
    status(message: string, error?: boolean): void;
  };
}
export interface CityLoadingHandle {
  readonly active: boolean;
  readonly ready: Promise<void>;
  stage(message: string, track?: string): void;
  retain(signal?: AbortSignal): CityLoadingHandle;
  dispose(): void;
}
export interface CityLoadingDependencies {
  load(library: unknown, root: unknown): Promise<CityLoadingView>;
  resources(): CityLoadingResources | undefined;
}

/** The multiplayer loading paint routine over the city art, with truthful city stage text. */
class CityLoadingScreen extends RaceLoadingScreen implements CityLoadingView {
  showStatus(message: string): void {
    if (this.disposed) return;
    this.element.setAttribute("aria-label", "卡丁城加载中");
    this.progress.textContent = message;
    this.paint();
    this.element.hidden = false;
  }
}
/** City-only loading art under mirror/ui/loading; each entry draws one at random. */
export const CITY_LOADING_ART = [
  "/ui/loading/city-loading-1.webp", "/ui/loading/city-loading-2.webp",
] as const;

export function pickCityLoadingArt(random: () => number = Math.random): string {
  const index = Math.min(CITY_LOADING_ART.length - 1, Math.floor(random() * CITY_LOADING_ART.length));
  return CITY_LOADING_ART[index] ?? CITY_LOADING_ART[0];
}

async function cityLoadingArt(): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = pickCityLoadingArt();
  await image.decode();
  const background = document.createElement("canvas");
  background.className = "multiplayer-loading-board";
  background.width = image.naturalWidth;
  background.height = image.naturalHeight;
  background.getContext("2d")!.drawImage(image, 0, 0);
  return background;
}

const defaults: CityLoadingDependencies = {
  async load(library, root) {
    const art = await cityLoadingArt().catch(() => undefined);
    if (art) return new CityLoadingScreen(root as HTMLElement, art);
    // The release race loading art stays as the fallback when the city art is missing.
    const [{ U1 }, { p2 }] = await Promise.all([
      import("../generated/library.js"), import("../generated/formats.js"),
    ]);
    return CityLoadingScreen.load(library, root as HTMLElement, {
      imageBytes: (source, roots, name) => U1(source, roots, name).bytes(),
      decodeImage: bytes => p2(bytes),
    });
  },
  resources: currentResourceManager,
};
const active = new WeakMap<CityLoadingHost, LoadingState>();

class LoadingState {
  refs = 0;
  closed = false;
  message = "正在连接卡丁城…";
  track?: string;
  view?: CityLoadingView;
  releaseProgress?: () => void;
  readonly resources?: CityLoadingResources;
  readonly ready: Promise<void>;

  constructor(readonly host: CityLoadingHost, deps: CityLoadingDependencies) {
    this.resources = deps.resources();
    this.releaseProgress = this.resources?.subscribe(() => this.paint());
    this.ready = Promise.resolve().then(() => deps.load(host.options.library, host.options.root)).then(view => {
      if (this.closed || host.disposed) {
        view.dispose();
        this.close();
        return;
      }
      this.view = view;
      this.paint();
    }).catch(error => {
      if (!this.closed && !host.disposed)
        host.options.status(`卡丁城加载画面资源失败：${error instanceof Error ? error.message : String(error)}`, true);
    });
  }

  paint(): void {
    if (this.closed) return;
    if (this.host.disposed) { this.close(); return; }
    let message = this.message;
    if (this.track && this.resources) {
      const containers = this.resources.trackContainers(this.track);
      const total = this.resources.bytesOf(containers);
      if (total > 0) {
        const loaded = Math.max(0, Math.min(total, this.resources.bytesDone(containers)));
        const mib = (bytes: number) => (bytes / 1048576).toFixed(1);
        message += `  ${mib(loaded)} / ${mib(total)} MB`;
      }
    }
    this.view?.showStatus(message);
  }

  retain(signal?: AbortSignal): CityLoadingHandle {
    const state = this;
    this.refs++;
    let released = false;
    let cancelled: (() => void) | undefined;
    const onAbort = () => { this.close(); cancelled?.(); };
    const ready = signal
      ? Promise.race([this.ready, new Promise<void>(resolve => { cancelled = resolve; })])
      : this.ready;
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return {
      get active() { return !state.closed; },
      ready,
      stage: (message, track) => {
        if (released || this.closed) return;
        this.message = message;
        this.track = track;
        this.paint();
      },
      retain: nextSignal => this.retain(nextSignal),
      dispose: () => {
        if (released) return;
        released = true;
        signal?.removeEventListener("abort", onAbort);
        if (--this.refs === 0) this.close();
      },
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseProgress?.();
    this.releaseProgress = undefined;
    this.view?.dispose();
    this.view = undefined;
    if (active.get(this.host) === this) active.delete(this.host);
  }
}

/** One overlay spans homepage connection, node allocation and scene preparation. */
export function beginCityLoading(host: CityLoadingHost, signal?: AbortSignal,
  dependencies: CityLoadingDependencies = defaults): CityLoadingHandle {
  const inherited = host.options.cityLoading;
  if (inherited?.active) return inherited.retain(signal);
  let state = active.get(host);
  if (!state || state.closed) {
    state = new LoadingState(host, dependencies);
    active.set(host, state);
  }
  return state.retain(signal);
}

/** Resolve after the actual scene render, rather than a timer or predicted progress. */
export function firstCityFrame(stage: { render(...args: any[]): any }, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const render = stage.render;
    const finish = () => {
      if (stage.render === wrapped) stage.render = render;
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const wrapped = function(this: typeof stage, ...args: any[]) {
      const result = render.apply(this, args);
      finish();
      return result;
    };
    stage.render = wrapped;
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
