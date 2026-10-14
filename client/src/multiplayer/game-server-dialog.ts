/** Game server picker shown before entering the lobby when several servers are open. */

import { te } from "../generated/library.js";
import { node, nodeName, paintText, prepare, type BmlLibrary, type Node, type NodeState,
  type WindowView } from "../ui/bml-kit";
import { gameRoot, gameWindowLibrary, popupLayer, trapPopupKeys } from "../ui/game-popups";
import type { GameServer, GameServerOption } from "./game-servers";

export interface GameServerPickerDependencies {
  createElement(tag: string): HTMLElement;
  overlayStyle: string;
  panelStyle: string;
  styleButtons(...buttons: HTMLButtonElement[]): void;
}

const listStyle =
  "display:grid;gap:6px;max-height:min(50vh,360px);overflow-y:auto;overscroll-behavior:contain";
const rowStyle =
  "display:flex;align-items:center;gap:10px;padding:8px 10px;background:#1a2b40;border:1px solid #5599d5;cursor:pointer";
const unavailableRowStyle =
  "display:flex;align-items:center;gap:10px;padding:8px 10px;background:#1a2b40;border:1px solid #4a5a6c;opacity:.55;cursor:not-allowed";

/** "在线 12/400 · 房间 3", plus why the server cannot be chosen. */
export function gameServerSummary(option: GameServerOption): string {
  const { players, capacity, rooms } = option.server;
  return `在线 ${players}/${capacity} · 房间 ${rooms}` +
    (option.unavailable ? ` · ${option.unavailable}` : "");
}

const HEADING_ID = "kartsim-game-server-title";

/**
 * Let the player choose a server. Unavailable servers are listed but cannot be
 * selected; "返回", Escape and the abort signal reject with ACCOUNT_CANCELLED
 * like the other account dialogs. The panel is a modal dialog: Tab and
 * Shift+Tab stay inside it.
 */
export function showGameServerPicker(dependencies: GameServerPickerDependencies,
  root: HTMLElement, options: GameServerOption[], selected: string,
  signal?: AbortSignal): Promise<GameServer> {
  if (signal?.aborted) return Promise.reject(new Error("ACCOUNT_CANCELLED"));
  const library = gameWindowLibrary();
  if (library) return gameServerWindow(library, gameRoot(root.ownerDocument), options, selected, signal);
  return new Promise<GameServer>((resolve, reject) => {
    const overlay = dependencies.createElement("div");
    const form = dependencies.createElement("form") as HTMLFormElement;
    overlay.style.cssText = dependencies.overlayStyle;
    // Clicking the backdrop keeps focus (and so Escape and Tab) in the picker.
    overlay.tabIndex = -1;
    form.style.cssText = dependencies.panelStyle;
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-labelledby", HEADING_ID);
    const heading = dependencies.createElement("h2");
    heading.id = HEADING_ID;
    heading.textContent = "选择游戏服务器";
    heading.style.margin = "0";
    const description = dependencies.createElement("div");
    description.textContent = "想一起玩的玩家请选择同一个服务器。";
    const list = dependencies.createElement("div");
    list.style.cssText = listStyle;
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", "游戏服务器");

    const choices: Array<{ input: HTMLInputElement; server: GameServer }> = [];
    for (const option of options) {
      const row = dependencies.createElement("label");
      row.style.cssText = option.unavailable ? unavailableRowStyle : rowStyle;
      const input = dependencies.createElement("input") as HTMLInputElement;
      input.type = "radio";
      input.name = "kartsim-game-server";
      input.value = option.server.nodeId;
      input.disabled = !!option.unavailable;
      input.checked = !option.unavailable && option.server.nodeId === selected;
      const text = dependencies.createElement("span");
      text.style.cssText = "display:grid;gap:2px;flex:1;min-width:0";
      const name = dependencies.createElement("span");
      name.textContent = option.server.name;
      name.style.cssText = "overflow-wrap:anywhere;font-weight:bold";
      const summary = dependencies.createElement("span");
      summary.textContent = gameServerSummary(option);
      summary.style.cssText = "font-size:14px;color:#c8d8ea";
      text.append(name, summary);
      row.append(input, text);
      list.append(row);
      if (!option.unavailable) choices.push({ input, server: option.server });
    }

    const errorText = dependencies.createElement("div");
    errorText.style.cssText = "min-height:20px;color:#ffb3a9";
    errorText.setAttribute("role", "alert");
    const submit = dependencies.createElement("button") as HTMLButtonElement;
    submit.type = "submit";
    submit.textContent = "进入服务器";
    const back = dependencies.createElement("button") as HTMLButtonElement;
    back.type = "button";
    back.textContent = "返回";
    dependencies.styleButtons(submit, back);

    /** The radio group is one tab stop: the checked radio, else the first one. */
    const firstStop = () =>
      (choices.find(entry => entry.input.checked) ?? choices[0])?.input ?? submit;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      overlay.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("ACCOUNT_CANCELLED"));
    };
    // Handled on the overlay so the window's Escape-to-pause never sees it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onAbort();
        return;
      }
      if (event.key !== "Tab") return;
      const active = root.ownerDocument.activeElement;
      const radio = choices.some(entry => entry.input === active);
      if (event.shiftKey ? radio || active === firstStop() || !form.contains(active)
        : active === back || !form.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? back : firstStop()).focus();
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    overlay.addEventListener("keydown", onKey);
    back.onclick = onAbort;
    form.onsubmit = event => {
      event.preventDefault();
      const choice = choices.find(entry => entry.input.checked);
      if (!choice) {
        errorText.textContent = "请选择一个游戏服务器。";
        return;
      }
      cleanup();
      resolve(choice.server);
    };
    form.append(heading, description, list, errorText, submit, back);
    overlay.append(form);
    root.ownerDocument.body.append(overlay);
    firstStop().focus();
  });
}

const ROOTS = ["stage_/common"];
const TEXT = "rgb(42,55,80)";
const WIDTH = 500;
const ROWS = 6;
const ROW = { top: 46, height: 50, step: 54 };

function serverWindowDefinition(rows: number, paged: boolean): Node {
  const children: Node[] = [
    node("Label", { name: "serverInfo", leftTopWH: `0 12 ${WIDTH - 90} 26`, align: "hcenter" }),
  ];
  for (let index = 0; index < rows; index++) {
    const y = ROW.top + index * ROW.step;
    children.push(node("Window", { name: `serverRow${index}`, leftTopWH: `0 ${y} ${WIDTH - 90} ${ROW.height}`,
      align: "hcenter", frame: "InnerFrame" }, [
      node("PlaneCheckButton", { name: `serverCheck${index}`, leftTopWH: `12 ${(ROW.height - 16) / 2} 16 16` }),
      node("TextButton", { name: `serverPick${index}`, leftTopWH: `0 0 ${WIDTH - 90} ${ROW.height}`, frame: "NoFrame" }),
    ]));
  }
  let y = ROW.top + rows * ROW.step;
  if (paged) {
    children.push(
      node("TextButton", { name: "serverPrevious", leftTopWH: `${WIDTH / 2 - 135} ${y} 80 26`, textRender: "bold14" }),
      node("Label", { name: "serverPage", leftTopWH: `${WIDTH / 2 - 75} ${y} 100 26` }),
      node("TextButton", { name: "serverNext", leftTopWH: `${WIDTH / 2 + 25} ${y} 80 26`, textRender: "bold14" }),
    );
    y += 32;
  }
  children.push(
    node("Label", { name: "serverError", leftTopWH: `0 ${y} ${WIDTH - 90} 22`, align: "hcenter" }),
    node("Window", { leftTopWH: `0 0 ${WIDTH - 56} 1`, frame: "HSection", align: "hcenter;bottom", adjust: "0 63" }),
    node("TextButton", { name: "okButton", leftTopWH: "0 0 132 42", align: "hcenter;bottom", adjust: "-70 6",
      textRender: "bold16" }),
    node("TextButton", { name: "cancelButton", leftTopWH: "0 0 132 42", align: "hcenter;bottom", adjust: "70 6",
      textRender: "bold16" }),
  );
  return node("Panel", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "serverDialog", windowRect: `0 0 ${WIDTH} ${y + 28 + 118}`, frame: "CaptionDialog",
      caption: "选择游戏服务器", captionPos: "0 1", align: "center", textRender: "bold" }, children),
  ]);
}

/** The picker in the game's look: CaptionDialog, a check row a server, 进入服务器 / 返回. */
function gameServerWindow(library: BmlLibrary, root: HTMLElement, options: GameServerOption[], selected: string,
  signal?: AbortSignal): Promise<GameServer> {
  return new Promise<GameServer>((resolve, reject) => {
    const layer = popupLayer(root);
    const paged = options.length > ROWS;
    const rows = Math.min(ROWS, options.length);
    let choice = options.find(option => !option.unavailable && option.server.nodeId === selected)?.server.nodeId;
    let page = Math.floor(Math.max(0, options.findIndex(option => option.server.nodeId === choice)) / ROWS);
    const pages = Math.ceil(options.length / ROWS);
    let error = "";
    let view: WindowView | undefined;
    let releaseKeys: (() => void) | undefined;
    let done = false;
    const finish = (server?: GameServer) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", cancel);
      releaseKeys?.();
      view?.dispose();
      layer.dispose();
      if (server) resolve(server);
      else reject(new Error("ACCOUNT_CANCELLED"));
    };
    const cancel = () => finish();
    const enter = () => {
      const server = options.find(option => !option.unavailable && option.server.nodeId === choice)?.server;
      if (server) finish(server);
      else {
        error = "请选择一个游戏服务器。";
        view?.render();
      }
    };
    const pick = (option: GameServerOption) => {
      if (option.unavailable) return;
      choice = option.server.nodeId;
      error = "";
      view?.render();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const state = (entry: Node): NodeState => {
      const name = nodeName(entry);
      const row = /^server(?:Row|Check|Pick)(\d+)$/.exec(name);
      if (row) {
        const option = options[page * ROWS + Number(row[1])];
        if (!option) return { visible: false };
        if (name.startsWith("serverRow")) return {};
        const chosen = option.server.nodeId === choice;
        if (name.startsWith("serverCheck")) return { checked: chosen, disabled: !!option.unavailable,
          label: option.server.name, ...option.unavailable ? {} : { action: () => pick(option) } };
        return { text: "", label: `${option.server.name} ${gameServerSummary(option)}`, checked: chosen,
          disabled: !!option.unavailable, ...option.unavailable ? {} : { action: () => pick(option) },
          paint: (context: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }) => {
            const color = option.unavailable ? "rgb(150,156,168)" : TEXT;
            const text = { x: rect.x + 38, width: rect.width - 50 };
            paintText(option.server.name, { size: 15, bold: true, color: chosen ? "rgb(30,110,210)" : color })
              .paint(context, { ...text, y: rect.y + 6, height: 18 });
            paintText(gameServerSummary(option), { size: 13, color })
              .paint(context, { ...text, y: rect.y + 27, height: 16 });
          } };
      }
      switch (name) {
        case "serverDialog": return { text: "选择游戏服务器" };
        case "serverInfo": return paintText("想一起玩的玩家请选择同一个服务器。", { size: 14, bold: true, color: TEXT,
          middle: true });
        case "serverPrevious": return { text: "上一页", label: "上一页", disabled: page === 0,
          action: () => { page--; view?.render(); } };
        case "serverNext": return { text: "下一页", label: "下一页", disabled: page >= pages - 1,
          action: () => { page++; view?.render(); } };
        case "serverPage": return paintText(`${page + 1} / ${pages}`, { size: 14, bold: true, color: TEXT,
          align: "center", middle: true });
        case "serverError": return paintText(error, { size: 13, bold: true, color: "rgb(205,45,35)", middle: true });
        case "okButton": return { text: "进入服务器", label: "进入服务器", action: enter };
        case "cancelButton": return { text: "返回", label: "返回", action: cancel };
      }
      return {};
    };
    void (te.load({ library, root: layer.element, definition: prepare(library, serverWindowDefinition(rows, paged), ROOTS),
      roots: ROOTS, smoothImages: true, modal: true, label: "选择游戏服务器", onCancel: cancel, onConfirm: enter,
      state } as never) as Promise<WindowView>).then(loaded => {
      if (done) {
        loaded.dispose();
        return;
      }
      view = loaded;
      // Escape goes back and Enter enters, before the window's Escape-to-pause sees them.
      releaseKeys = trapPopupKeys(loaded.element, { cancel, confirm: enter });
      view.show();
      view.focus("okButton");
    }).catch(failure => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", cancel);
      layer.dispose();
      reject(failure);
    });
  });
}
