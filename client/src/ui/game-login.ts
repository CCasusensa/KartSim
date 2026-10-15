import { te } from "../generated/library.js";
import { LOGIN_FIELD_LABELS, LoginForm, type LoginField, type LoginFormRequests } from "../account/login-form";
import type { AccountLoginOptions } from "../multiplayer/account-login-dialog";
import { node, nodeName, paintText, prepare, type BmlLibrary, type Node, type NodeState,
  type WindowView } from "./bml-kit";
import { gameWindowLibrary, popupLayer, showGameMessage as showPopupMessage, showGameStatus as showPopupStatus,
  type GameStatus } from "./game-popups";
import { tr } from "../i18n/locale";

export { gameWindowLibrary };

/**
 * The account windows in the game's look, drawn by the release window
 * renderer like the other dialogs (CaptionDialog, DefaultEdit fields,
 * TextButtons): the startup login / register form (account/login-form.ts)
 * and the login gate's status and 重试 messages. They sit in their own
 * layer over the startup loading screen, sized like the game area.
 */

const ROOTS = ["stage_/common"];
const TEXT = "rgb(42,55,80)";
const WIDTH = 540;
const ROW = { label: 130, edit: 330, height: 32, step: 44 };
const RULES = "账号名 3–24 位字母、数字或下划线；游戏昵称 1–16 字；密码至少 8 位。";

async function loadWindow(library: BmlLibrary, root: HTMLElement, definition: Node, label: string,
  state: (entry: Node) => NodeState, onCancel?: () => void): Promise<WindowView> {
  return await te.load({ library, root, definition: prepare(library, definition, ROOTS), roots: ROOTS,
    smoothImages: true, modal: true, label, onCancel, state }) as WindowView;
}

/** A TextButton's state: the renderer draws `text`; `label` names it for assistive tech. */
function button(text: string, action: () => void, disabled = false): NodeState {
  return { text, label: text, disabled, ...(disabled ? {} : { action }) };
}

const AUTOCOMPLETE: Record<LoginField, (register: boolean) => string> = {
  username: () => "username",
  nickname: () => "nickname",
  password: register => register ? "new-password" : "current-password",
  confirm: () => "new-password",
  invite: () => "off",
};

export interface LoginWindowText {
  heading: string;
  hint?: string;
}

/** The form's tree for its current mode: a labelled DefaultEdit a field, then the buttons. */
export function loginWindowDefinition(form: LoginForm, text: LoginWindowText): Node {
  const register = form.mode === "register";
  const children: Node[] = [];
  let y = 14;
  if (text.hint) {
    children.push(node("Label", { name: "hint", leftTopWH: `20 ${y} ${WIDTH - 60} 36` }));
    y += 46;
  }
  for (const field of form.fields()) {
    children.push(
      node("Label", { name: `${field}Label`, leftTopWH: `20 ${y} ${ROW.label - 12} ${ROW.height}`, textRender: "bold15",
        textColor: "255 72 106 163", textAlign: "right|vcenter", text: tr(LOGIN_FIELD_LABELS[field]) }),
      node("Edit", { name: field, leftTopWH: `${20 + ROW.label} ${y} ${ROW.edit} ${ROW.height}`, frame: "DefaultEdit",
        textRender: "bold16" }),
    );
    y += ROW.step;
  }
  if (register) {
    // One line across the form, under the last field.
    children.push(node("Label", { name: "rules", leftTopWH: `20 ${y - 4} ${WIDTH - 60} 20` }));
    y += 24;
  }
  if (form.inviteToggleShown()) {
    children.push(node("TextButton", { name: "inviteToggle", leftTopWH: `${20 + ROW.label} ${y} 96 22`, frame: "NoFrame",
      textRender: "bold14", textAlign: "left|vcenter" }));
    y += 28;
  }
  children.push(node("Label", { name: "error", leftTopWH: `20 ${y} ${WIDTH - 60} 24` }));
  y += 30;
  const twoButtons = form.canRegister;
  children.push(
    node("Window", { leftTopWH: `0 0 ${WIDTH - 50} 1`, frame: "HSection", align: "hcenter;bottom", adjust: "0 63" }),
    node("TextButton", { name: "okButton", leftTopWH: "0 0 150 38", align: "hcenter;bottom",
      adjust: twoButtons ? "-84 12" : "0 12", textRender: "bold16" }),
  );
  if (twoButtons) {
    children.push(node("TextButton", { name: "modeButton", leftTopWH: "0 0 150 38", align: "hcenter;bottom",
      adjust: "84 12", textRender: "bold16" }));
  }
  // Caption bar and client margins (CaptionDialog) plus the button strip.
  const height = y + 118;
  return node("Panel", { windowRect: "fullscreen" }, [
    node("CaptionWindow", { name: "loginDialog", windowRect: `0 0 ${WIDTH} ${height}`, frame: "CaptionDialog",
      caption: text.heading, captionPos: "0 1", align: "center", textRender: "bold" }, children),
  ]);
}

/**
 * The startup login / register window; resolves with the signed-in
 * account. It has no close: the player must sign in (no guest path).
 */
export async function openGameLogin(library: BmlLibrary, root: HTMLElement, options: AccountLoginOptions,
  requests: LoginFormRequests): Promise<unknown> {
  const form = new LoginForm(options, requests);
  const host = popupLayer(root, { dim: true, zIndex: 8 });
  let view: WindowView | undefined;
  let finish!: (account: unknown) => void;
  const done = new Promise<unknown>(resolve => { finish = resolve; });
  const heading = () => tr(form.mode === "register" ? "跑跑卡丁车 · 注册新账号" : options.heading ?? "跑跑卡丁车 · 账号登录");
  const render = () => view?.render();
  const submit = async () => {
    if (form.busy) return;
    const pending = form.submit();
    render();
    const account = await pending;
    if (account !== undefined) finish(account);
    else render();
  };
  const state = (entry: Node): NodeState => {
    const name = nodeName(entry);
    const register = form.mode === "register";
    switch (name) {
      case "loginDialog": return { text: heading() };
      case "hint": return paintText(options.hint ?? "", { size: 13, color: TEXT, align: "center", middle: true,
        lineGap: 5 });
      case "rules": return paintText(tr(RULES), { size: 12, color: "rgb(110,120,140)", align: "center", middle: true });
      case "inviteToggle": return { ...button(tr("有邀请码？"), () => {
        form.revealInvite();
        void build("invite");
      }, form.busy), textColor: "rgb(30,110,210)" };
      case "error": return paintText(form.busy ? tr(register ? "正在注册…" : "正在登录…") : form.error, {
        size: 13, color: form.busy ? TEXT : "rgb(205,45,35)", bold: !form.busy, middle: true });
      case "okButton": return button(tr(register ? "注册并登录" : "登录"), () => void submit(), form.busy);
      case "modeButton": return button(tr(register ? "已有账号，去登录"
        : options.invite === "required" || options.invite === undefined ? "用邀请码注册" : "注册新账号"), () => {
        form.toggleMode();
        void build();
      }, form.busy);
    }
    if (name in LOGIN_FIELD_LABELS && !name.endsWith("Label")) {
      const field = name as LoginField;
      return { label: tr(LOGIN_FIELD_LABELS[field]), disabled: form.busy, input: {
        value: form.values[field], maxLength: form.maxLength(field),
        password: field === "password" || field === "confirm",
        autocomplete: AUTOCOMPLETE[field](register),
        change: (value: string) => form.set(field, value),
        submit: () => void submit(),
      } };
    }
    return {};
  };
  /** Rebuilt when the fields change (mode, 有邀请码？); the values stay in the form. */
  let building = Promise.resolve();
  const build = (focus?: LoginField): Promise<void> => building = building.then(async () => {
    const next = await loadWindow(library, host.element, loginWindowDefinition(form, { heading: heading(),
      hint: options.hint }), heading(), state);
    view?.dispose();
    view = next;
    view.show();
    view.focus(focus ?? form.fields().find(field => !form.values[field]) ?? form.fields()[0]);
  });
  try {
    await build();
    return await done;
  } finally {
    await building.catch(() => undefined);
    view?.dispose();
    host.dispose();
  }
}

/** A message with one button (重试, 重新登录…); resolves when it is chosen. */
export async function showGameMessage(library: BmlLibrary, root: HTMLElement, title: string, text: string,
  buttonText: string): Promise<void> {
  await showPopupMessage(title, text, { library, root, yes: buttonText, dim: true });
}

/**
 * A blocking status line (正在连接数据服务…). Shown only when it lasts
 * past a moment, so quick steps do not flash a window.
 */
export function showGameStatus(library: BmlLibrary, root: HTMLElement, title: string, text: string,
  delayMs = 300): GameStatus {
  return showPopupStatus(title, text, { library, root, delayMs, dim: true });
}
