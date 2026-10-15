import { tr } from "../i18n/locale";
/**
 * The account panel opened from the lobby rider (ECONOMY.md 7.8): username,
 * nickname with rename, level and experience, the three balances, race
 * statistics, the registration date and logout. It is a game window
 * (CaptionDialog, DefaultEdit, TextButtons) once the resources are loaded;
 * a plain overlay stands in before that (and in tests).
 */
import { te } from "../generated/library.js";
import type { AccountSummary } from "../account/account-session";
import { validateNickname } from "../account/account-api";
import {
  accountErrorMessages, accountOverlayStyle, accountPanelStyle, styleAccountButtons,
} from "../multiplayer/account-ui-support";
import { node, nodeName, paintText, prepare, type BmlLibrary, type Node, type NodeState,
  type WindowView } from "./bml-kit";
import { gameRoot, gameWindowLibrary, popupLayer, trapPopupKeys } from "./game-popups";

export interface AccountPanelSession {
  summary(): AccountSummary | undefined;
  subscribe(listener: () => void): () => void;
  updateNickname(nickname: string): Promise<void>;
}

export interface AccountPanelDocument {
  body: { append(node: HTMLElement): void };
  createElement(tag: string): HTMLElement;
}

export interface AccountPanelOptions {
  document: AccountPanelDocument;
  session: AccountPanelSession;
  /** A reason logout is not possible now (in a multiplayer room or race). */
  logoutBlocked?(): string | undefined;
  onLogout(): void | Promise<void>;
  onClose?(): void;
  onActivate?(): void;
}

export interface AccountPanelHandle {
  readonly element: HTMLElement;
  close(): void;
}

const rowStyle = "display:grid;grid-template-columns:5.5em 1fr;gap:4px 10px;align-items:center";
const inputStyle = "box-sizing:border-box;width:100%;padding:7px;background:#fff;color:#152333;border:0;font:inherit";

function formatNumber(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

/** "2026-10-07" in local time; "未知" without a date. */
export function formatAccountDate(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return tr("未知");
  const date = new Date(milliseconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "1,234 / 5,000" inside the level, or the total at the top level. */
export function formatAccountExperience(progress: AccountSummary["progress"]): string {
  if (progress.nextLevelExp === null) return tr("{value}（已满级）", { value: String(formatNumber(progress.exp)) });
  const span = Math.max(1, progress.nextLevelExp - progress.levelExp);
  const inLevel = Math.max(0, progress.exp - progress.levelExp);
  return tr("{value} / {value2}（累计 {value3}）", { value: String(formatNumber(inLevel)), value2: String(formatNumber(span)), value3: String(formatNumber(progress.exp)) });
}

/** The panel rows as label/value pairs, in display order. */
export function accountPanelRows(summary: AccountSummary): Array<[string, string]> {
  const { account, progress, wallet, stats } = summary;
  return [
    [tr("账号名"), account.username],
    [tr("等级"), `Lv.${progress.level}${progress.gloveName ? ` ${tr(progress.gloveName)}` : ""}`],
    [tr("经验"), formatAccountExperience(progress)],
    [tr("点券"), formatNumber(wallet.coupon)],
    [tr("金币"), formatNumber(wallet.lucci)],
    [tr("K币"), formatNumber(wallet.koin)],
    [tr("战绩"), tr("比赛 {value} 场 · 冠军 {value2} · ", { value: String(formatNumber(stats.races)), value2: String(formatNumber(stats.wins)) }) +
      tr("前三 {value} · 积分 {value2}", { value: String(formatNumber(stats.podiums)), value2: String(formatNumber(stats.points)) })],
    [tr("注册时间"), formatAccountDate(account.createdAt)],
  ];
}

function errorText(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return accountErrorMessages[code] ? tr(accountErrorMessages[code]!) : code;
}

/** What 修改昵称 answers: the text under the field and whether it worked. */
async function renameAccount(session: AccountPanelSession, value: string): Promise<{ ok: boolean; text: string }> {
  const problem = validateNickname(value);
  if (problem) return { ok: false, text: tr(problem) };
  if (value === session.summary()?.account.nickname) return { ok: false, text: tr("昵称没有变化。") };
  try {
    await session.updateNickname(value);
    return { ok: true, text: tr("昵称已修改。") };
  } catch (error) {
    return { ok: false, text: errorText(error) };
  }
}

export function openAccountPanel(options: AccountPanelOptions): AccountPanelHandle {
  const library = gameWindowLibrary();
  if (library) return openGameAccountPanel(library, options);
  const { document, session } = options;
  const create = <T extends HTMLElement>(tag: string, text?: string): T => {
    const node = document.createElement(tag) as T;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const overlay = create<HTMLDivElement>("div");
  overlay.style.cssText = accountOverlayStyle;
  overlay.dataset.kartsimAccount = "panel";
  const panel = create<HTMLDivElement>("div");
  panel.style.cssText = accountPanelStyle;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", tr("账号信息"));
  const heading = create<HTMLHeadingElement>("h2", tr("账号信息"));
  heading.style.margin = "0";
  const rows = create<HTMLDivElement>("div");
  rows.style.cssText = rowStyle;
  const nickname = create<HTMLInputElement>("input");
  nickname.style.cssText = inputStyle;
  nickname.maxLength = 16;
  nickname.placeholder = tr("游戏昵称（1–16 字）");
  nickname.setAttribute("aria-label", tr("游戏昵称"));
  const rename = create<HTMLButtonElement>("button", tr("修改昵称"));
  rename.type = "button";
  const message = create<HTMLDivElement>("div");
  message.style.cssText = "min-height:20px;color:#ffb3a9";
  const logout = create<HTMLButtonElement>("button", tr("退出登录"));
  logout.type = "button";
  const close = create<HTMLButtonElement>("button", tr("关闭"));
  close.type = "button";
  styleAccountButtons(rename, logout, close);
  const nameRow = create<HTMLDivElement>("div");
  nameRow.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:8px";
  nameRow.append(nickname, rename);

  let editedName = false;
  nickname.oninput = () => { editedName = true; };
  const render = () => {
    const summary = session.summary();
    if (!summary) return;
    if (!editedName) nickname.value = summary.account.nickname;
    rows.replaceChildren(...accountPanelRows(summary).flatMap(([label, value]) => {
      const name = create<HTMLSpanElement>("span", label);
      name.style.color = "#a9bddf";
      return [name, create<HTMLSpanElement>("span", value)];
    }));
  };
  render();
  const unsubscribe = session.subscribe(render);

  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    overlay.remove();
    options.onClose?.();
  };
  rename.onclick = async () => {
    options.onActivate?.();
    const value = nickname.value;
    const problem = validateNickname(value);
    if (problem) {
      message.textContent = tr(problem);
      return;
    }
    if (value === session.summary()?.account.nickname) {
      message.textContent = tr("昵称没有变化。");
      return;
    }
    rename.disabled = true;
    message.textContent = "";
    try {
      await session.updateNickname(value);
      editedName = false;
      render();
      message.style.color = "#b8f0a0";
      message.textContent = tr("昵称已修改。");
    } catch (error) {
      message.style.color = "#ffb3a9";
      message.textContent = errorText(error);
    } finally {
      rename.disabled = false;
    }
  };
  logout.onclick = async () => {
    options.onActivate?.();
    const blocked = options.logoutBlocked?.();
    if (blocked) {
      message.style.color = "#ffb3a9";
      message.textContent = blocked;
      return;
    }
    logout.disabled = true;
    finish();
    await options.onLogout();
  };
  close.onclick = () => {
    options.onActivate?.();
    finish();
  };
  overlay.addEventListener("keydown", event => {
    if ((event as KeyboardEvent).key === "Escape") finish();
  });
  overlay.addEventListener("click", event => {
    if (event.target === overlay) finish();
  });
  panel.append(heading, rows, nameRow, message, logout, close);
  overlay.append(panel);
  document.body.append(overlay);
  close.focus();
  return { element: overlay, close: finish };
}

const ROOTS = ["stage_/common"];
const TEXT = "rgb(42,55,80)";
const LABEL = "rgb(72,106,163)";
const WIDTH = 540;
const ROW = { top: 14, step: 30, label: 104, value: 136 };

function accountWindowDefinition(rows: number): Node {
  const children: Node[] = [];
  for (let index = 0; index < rows; index++) {
    const y = ROW.top + index * ROW.step;
    children.push(
      node("Label", { name: `rowLabel${index}`, leftTopWH: `20 ${y} ${ROW.label} 24` }),
      node("Label", { name: `rowValue${index}`, leftTopWH: `${ROW.value} ${y} ${WIDTH - ROW.value - 70} 24` }),
    );
  }
  let y = ROW.top + rows * ROW.step + 6;
  children.push(
    node("Window", { leftTopWH: `0 ${y - 4} ${WIDTH - 60} 1`, frame: "HSection", align: "hcenter" }),
    node("Label", { name: "nicknameLabel", leftTopWH: `20 ${y + 10} ${ROW.label} 30` }),
    node("Edit", { name: "nickname", leftTopWH: `${ROW.value} ${y + 10} 188 30`, frame: "DefaultEdit", textRender: "bold16" }),
    node("TextButton", { name: "renameButton", leftTopWH: `${ROW.value + 198} ${y + 9} 132 32`, textRender: "bold15" }),
  );
  y += 48;
  children.push(
    node("Label", { name: "message", leftTopWH: `${ROW.value} ${y} ${WIDTH - ROW.value - 70} 22` }),
    node("Window", { leftTopWH: `0 0 ${WIDTH - 60} 1`, frame: "HSection", align: "hcenter;bottom", adjust: "0 63" }),
    node("TextButton", { name: "okButton", leftTopWH: "0 0 132 42", align: "hcenter;bottom", adjust: "-70 6",
      textRender: "bold16" }),
    node("TextButton", { name: "logoutButton", leftTopWH: "0 0 132 42", align: "hcenter;bottom", adjust: "70 6",
      textRender: "bold16" }),
  );
  return node("Panel", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "accountDialog", windowRect: `0 0 ${WIDTH} ${y + 30 + 118}`, frame: "CaptionDialog",
      caption: tr("账号信息"), captionPos: "0 1", align: "center", textRender: "bold" }, children),
  ]);
}

/** The account panel as a game window over the game area. */
function openGameAccountPanel(library: BmlLibrary, options: AccountPanelOptions): AccountPanelHandle {
  const { session } = options;
  const root = gameRoot(options.document as unknown as Document);
  const layer = popupLayer(root);
  let view: WindowView | undefined;
  let closed = false;
  let busy = false;
  let nickname = session.summary()?.account.nickname ?? "";
  let editedName = false;
  let message = { text: "", error: false };
  const render = () => {
    if (!editedName) nickname = session.summary()?.account.nickname ?? nickname;
    view?.render();
  };
  const unsubscribe = session.subscribe(render);
  let releaseKeys: (() => void) | undefined;
  const finish = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    releaseKeys?.();
    view?.dispose();
    layer.dispose();
    options.onClose?.();
  };
  const rename = async () => {
    if (busy) return;
    options.onActivate?.();
    busy = true;
    message = { text: "", error: false };
    view?.render();
    const result = await renameAccount(session, nickname);
    busy = false;
    if (result.ok) editedName = false;
    message = { text: result.text, error: !result.ok };
    if (!closed) render();
  };
  const logout = async () => {
    options.onActivate?.();
    const blocked = options.logoutBlocked?.();
    if (blocked) {
      message = { text: blocked, error: true };
      view?.render();
      return;
    }
    finish();
    await options.onLogout();
  };
  const rowCount = accountPanelRows(session.summary() ?? summaryPlaceholder()).length;
  const state = (entry: Node): NodeState => {
    const name = nodeName(entry);
    const row = /^row(Label|Value)(\d+)$/.exec(name);
    if (row) {
      const summary = session.summary();
      const pair = summary ? accountPanelRows(summary)[Number(row[2])] : undefined;
      if (!pair) return { visible: false };
      return row[1] === "Label"
        ? paintText(pair[0], { size: 15, bold: true, color: LABEL, align: "right", middle: true })
        : paintText(pair[1], { size: 15, bold: true, color: TEXT, middle: true });
    }
    switch (name) {
      case "accountDialog": return { text: tr("账号信息") };
      case "nicknameLabel": return paintText(tr("游戏昵称"), { size: 15, bold: true, color: LABEL, align: "right",
        middle: true });
      case "nickname": return { label: tr("游戏昵称（1–16 字）"), disabled: busy, input: { value: nickname, maxLength: 16,
        submit: () => void rename(), change: (value: string) => {
          nickname = value;
          editedName = true;
        } } };
      case "renameButton": return { text: tr("修改昵称"), label: tr("修改昵称"), disabled: busy, action: () => void rename() };
      case "message": return paintText(busy ? tr("正在修改…") : message.text, { size: 13, bold: true, middle: true,
        color: message.error ? "rgb(205,45,35)" : "rgb(40,150,60)" });
      case "okButton": return { text: tr("关闭"), label: tr("关闭"), action: () => {
        options.onActivate?.();
        finish();
      } };
      case "logoutButton": return { text: tr("退出登录"), label: tr("退出登录"), action: () => void logout() };
    }
    return {};
  };
  void (te.load({ library, root: layer.element, definition: prepare(library, accountWindowDefinition(rowCount), ROOTS),
    roots: ROOTS, smoothImages: true, modal: true, label: tr("账号信息"), onCancel: finish, state } as never) as
    Promise<WindowView>).then(loaded => {
    if (closed) {
      loaded.dispose();
      return;
    }
    view = loaded;
    // Escape closes; Enter in the nickname field renames.
    releaseKeys = trapPopupKeys(loaded.element, { cancel: finish, confirm: () => {
      if (loaded.element.ownerDocument.activeElement instanceof HTMLInputElement) void rename();
    } });
    view.show();
    view.focus("okButton");
  }).catch(error => {
    console.warn("账号信息窗口打开失败", error);
    finish();
  });
  return { element: layer.element, close: finish };
}

function summaryPlaceholder(): AccountSummary {
  return { account: { username: "", nickname: "", createdAt: 0 }, progress: { level: 1, exp: 0, levelExp: 0,
    nextLevelExp: null }, wallet: { coupon: 0, lucci: 0, koin: 0 }, stats: { races: 0, wins: 0, podiums: 0,
    points: 0 } } as unknown as AccountSummary;
}
