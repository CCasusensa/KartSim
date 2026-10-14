/**
 * Blocking status view while multiplayer account services are checked: the
 * game's status box (shown only when the check takes a moment) and, on
 * failure, its message box with 返回 (ui/game-popups.ts). A plain overlay
 * stands in only before the game resources are loaded.
 */
import { gameRoot, gameWindowLibrary, showGameMessage, showGameStatus } from "../ui/game-popups";

export interface AccountProgressNode {
  style: { cssText: string; margin: string };
  textContent: string;
  hidden: boolean;
  type: string;
  onclick: (() => void) | null;
  setAttribute(name: string, value: string): void;
  append(...children: AccountProgressNode[]): void;
  remove(): void;
}

export interface AccountProgressRoot {
  ownerDocument?: {
    body?: AccountProgressNode;
    createElement(tag: string): AccountProgressNode;
  };
}

export interface AccountProgressSignal {
  addEventListener(type: "abort", listener: () => void,
    options?: { once: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface AccountProgressDependencies {
  overlayStyle: string;
  panelStyle: string;
  styleButtons(button: AccountProgressNode): void;
}

export interface AccountProgressSession {
  close(): void;
  fail(message: string): Promise<void>;
}

export function showAccountServiceProgress(root: AccountProgressRoot,
  signal: AccountProgressSignal | undefined,
  dependencies: AccountProgressDependencies): AccountProgressSession {
  const body = root.ownerDocument?.body;
  if (!body) return { close: () => {}, fail: async () => {} };
  const library = gameWindowLibrary();
  if (library) return gameProgress(gameRoot(root.ownerDocument as unknown as Document), signal);
  const overlay = root.ownerDocument!.createElement("div");
  const panel = root.ownerDocument!.createElement("div");
  overlay.style.cssText = dependencies.overlayStyle;
  panel.style.cssText = dependencies.panelStyle;
  panel.setAttribute("role", "status");
  const heading = root.ownerDocument!.createElement("h2");
  heading.textContent = "多人游戏";
  heading.style.margin = "0";
  const message = root.ownerDocument!.createElement("div");
  message.textContent = "正在检查联机服务…";
  const back = root.ownerDocument!.createElement("button");
  back.type = "button";
  back.textContent = "返回";
  back.hidden = true;
  dependencies.styleButtons(back);
  panel.append(heading, message, back);
  overlay.append(panel);
  body.append(overlay);

  let closed = false;
  let resolveDismissal: (() => void) | undefined;
  const dismissed = new Promise<void>(resolve => { resolveDismissal = resolve; });
  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", close);
    overlay.remove();
    resolveDismissal?.();
  };
  back.onclick = close;
  signal?.addEventListener("abort", close, { once: true });
  return {
    close,
    fail: async error => {
      if (!closed) {
        message.textContent = error;
        back.hidden = false;
        await dismissed;
      }
    },
  };
}

function gameProgress(root: HTMLElement, signal: AccountProgressSignal | undefined): AccountProgressSession {
  const status = showGameStatus("多人游戏", "正在检查联机服务…", { root });
  let closed = false;
  const abort = new AbortController();
  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", close);
    status.close();
    abort.abort();
  };
  signal?.addEventListener("abort", close, { once: true });
  return {
    close,
    fail: async error => {
      if (closed) return;
      status.close();
      await showGameMessage("多人游戏", error, { root, yes: "返回", signal: abort.signal }).catch(() => undefined);
      close();
    },
  };
}
