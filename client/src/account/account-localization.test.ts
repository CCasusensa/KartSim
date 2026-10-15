import assert from "node:assert/strict";
import test from "node:test";
import { tr, type GameLocale } from "../i18n/locale";
import { accountTranslations } from "../i18n/catalogs/account";
import { LoginForm } from "./login-form";
import { loginGateErrorMessage, startupLoginOptions } from "./login-gate";
import { AccountServiceError } from "./account-api";
import { remainingLabel } from "./ownership";
import { showAccountMessage, confirmAccountAction } from "./account-dialogs";
import { summaryFixture } from "./account-test-fixtures";
import { accountPanelRows, openAccountPanel } from "../ui/account-panel";
import { FakeDocument, installFakeDom } from "../ui/fake-dom";
import { GhostMenuPanel, type GhostSamplingMode } from "../timeattack/ghost-menu-panel";
import { OBSERVE_CAMERAS } from "../timeattack/replay-observe";

async function withLocale(locale: GameLocale, run: () => void | Promise<void>): Promise<void> {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { await run(); } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("startup login translates prompts and validation without changing submitted account fields", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, async () => {
    const sent: Array<Record<string, string>> = [];
    const options = startupLoginOptions("open");
    const form = new LoginForm(options, { requestAccount: async (_action, fields) => {
      sent.push(fields); return { token: "token" };
    }, formatError: loginGateErrorMessage });
    await form.submit();
    assert.equal(form.error, tr("请输入账号名。"));
    form.toggleMode();
    form.set("username", "user_name"); form.set("nickname", "玩家的昵称");
    form.set("password", "password1"); form.set("confirm", "mismatch");
    await form.submit();
    assert.equal(form.error, tr("两次输入的密码不一致。"));
    form.set("confirm", "password1"); form.set("nickname", " 前后空格 ");
    await form.submit();
    assert.equal(form.error, tr("昵称不能为空，且首尾不能有空格。"));
    form.set("nickname", "玩家的昵称");
    await form.submit();
    assert.deepEqual(sent, [{ username: "user_name", nickname: "玩家的昵称", password: "password1" }]);
    const unavailable = loginGateErrorMessage(new AccountServiceError("DATA_SERVICE_UNAVAILABLE"));
    const wrongPassword = loginGateErrorMessage(new AccountServiceError("INVALID_CREDENTIALS"));
    if (locale !== "zh-CN") {
      for (const value of [options.heading!, options.hint!, unavailable, wrongPassword, form.error])
        assert.ok(!/\p{Script=Han}/u.test(value), value);
    }
    assert.ok(loginGateErrorMessage(new Error("服务器自定义细节")).includes("服务器自定义细节"));
  });
});

test("account panel translates controls, stats and known ranks while preserving username and nickname", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, async () => {
    const document = new FakeDocument();
    const summary = summaryFixture();
    const session = { summary: () => summary, subscribe: () => () => {}, updateNickname: async () => {} };
    const panel = openAccountPanel({ document: document as never, session, onLogout() {} });
    const view = document.body.children.at(-1)!.children[0]!;
    const [heading, rows, nameRow, message, logout, close] = view.children;
    assert.equal(heading!.text(), tr("账号信息"));
    assert.equal(logout!.text(), tr("退出登录"));
    assert.equal(close!.text(), tr("关闭"));
    assert.equal(nameRow!.children[0]!.value, summary.account.nickname);
    const pairs = accountPanelRows(summary);
    assert.equal(pairs[0]![1], summary.account.username);
    nameRow!.children[0]!.value = " ";
    await nameRow!.children[1]!.fire("click");
    assert.equal(message!.text(), tr("昵称不能为空，且首尾不能有空格。"));
    if (locale !== "zh-CN") assert.ok(!/\p{Script=Han}/u.test(rows!.text()));
    panel.close();
  });
});

test("rental duration changes language at display time and retains expiry thresholds", async () => {
  for (const [locale, day, hour, minute] of [
    ["zh-CN", "剩余 2 天", "剩余 2 小时", "剩余 1 分钟"],
    ["en", "2 d left", "2 h left", "1 min left"],
    ["ko", "2일 남음", "2시간 남음", "1분 남음"],
  ] as const) await withLocale(locale, () => {
    assert.equal(remainingLabel(2 * 86_400_000, 0), day);
    assert.equal(remainingLabel(2 * 3_600_000, 0), hour);
    assert.equal(remainingLabel(1, 0), minute);
    assert.equal(remainingLabel(0, 0), tr("已过期"));
    assert.equal(remainingLabel(null, 0), undefined);
  });
});

test("account fallback dialogs translate default actions without rewriting supplied content", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, async () => {
    const document = new FakeDocument();
    const done = showAccountMessage(document as never, "用户提供标题", "用户提供说明");
    const content = document.body.children.at(-1)!.children[0]!;
    assert.equal(content.children[0]!.text(), "用户提供标题");
    const retry = content.children.at(-1)!;
    assert.equal(retry.text(), tr("重试"));
    await retry.fire("click"); await done;
    const confirmation = confirmAccountAction(document as never, "标题", "说明", "自定义动作");
    const cancel = document.body.children.at(-1)!.children[0]!.children.at(-1)!;
    assert.equal(cancel.text(), tr("取消"));
    await cancel.fire("click"); assert.equal(await confirmation, false);
  });
});

test("ghost tool controls and sampling labels translate while mode IDs and user records stay unchanged", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, async () => {
    const dom = installFakeDom();
    try {
      let sampling: GhostSamplingMode = "native";
      const saved: string[] = [], errors: string[] = [];
      const panel = new GhostMenuPanel({ root: dom.document.body as unknown as HTMLElement,
        samplingMode: () => sampling, onSamplingModeChange: mode => { sampling = mode; }, resetNickname() {},
        currentGhostKey: () => undefined, reportError: text => errors.push(text),
        deleteGhost: async () => {}, speedVersion: () => "国服", resolveGhostKartTitle: async () => undefined,
        importGhost: async () => {}, resolveGhostTrack: async () => undefined, selectGhostTrack: async () => {},
      }, {
        samplingLabels: { native: "原生", "native-smooth": "原生平滑", c1: "C1 曲线", c2: "C2 曲线" },
        nextSamplingMode: () => "native-smooth", saveSamplingMode: mode => saved.push(mode),
        import: {} as ConstructorParameters<typeof GhostMenuPanel>[1]["import"],
      });
      assert.equal(panel.menuEntries()[0]!.text, tr("导入影子(.ksv)"));
      panel.onSamplingModeToggle();
      assert.deepEqual(saved, ["native-smooth"]);
      assert.equal(sampling, "native-smooth");
      assert.ok(panel.samplingModeLabel().includes(tr("原生平滑")));
      await panel.deleteGhost(); await panel.exportGhost();
      if (locale !== "zh-CN") {
        const labels = [panel.title, panel.hint, ...panel.menuEntries().map(entry => entry.text), ...errors,
          ...OBSERVE_CAMERAS.map(camera => tr(camera.name))];
        assert.ok(labels.every(label => !/\p{Script=Han}/u.test(label)));
      }
      panel.dispose();
    } finally { dom.restore(); }
  });
});

test("account translations retain all interpolation parameters", () => {
  const parameters = (value: string) => [...value.matchAll(/\{[a-zA-Z0-9]+\}/g)].map(match => match[0]).sort();
  for (const [source, pair] of Object.entries(accountTranslations)) for (const translation of pair) {
    assert.deepEqual(parameters(translation), parameters(source), source);
    assert.ok(!/\p{Script=Han}/u.test(translation), source);
  }
});
