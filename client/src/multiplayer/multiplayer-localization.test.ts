import assert from "node:assert/strict";
import test from "node:test";
import { formatMultiplayerError, serverError } from "./errors";
import { accountErrorMessages, formatAccountServiceError } from "./account-ui-support";
import { chooseSignedInAccount, type AccountChoiceDependencies } from "./account-choice-dialog";
import { gameServerSummary } from "./game-server-dialog";
import { gameServerUnavailableReason, LOBBY_SERVER } from "./game-servers";
import { cheatKickMessage } from "./cheat-kick";
import { roomChannelNames, roomChannelKey } from "./lobby-room-options";
import { lobbyRoomNodeState, type LobbyRoomStateHost, type LobbyRoomStateDependencies } from "./lobby-room-state";
import { loadLobbyRoomTrack, type LobbyRoomTrackHost, type LobbyRoomTrackDependencies } from "./lobby-room-track";
import { tr, resourceText, type GameLocale } from "../i18n/locale";
import { lobbyTranslations } from "../i18n/catalogs/lobby";
import { installFakeDom } from "../ui/fake-dom";

async function withLocale(locale: GameLocale, run: () => void | Promise<void>): Promise<void> {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    value: { getItem: () => locale } });
  try { await run(); } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("account and room errors localize at lookup time, preserving server details and unknown errors", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, () => {
    assert.equal(formatMultiplayerError(new Error("WRONG_PASSWORD")), tr("房间密码错误，请重新输入。"));
    assert.equal(formatAccountServiceError(new Error("INVALID_NICKNAME")), tr(accountErrorMessages.INVALID_NICKNAME!));
    const reason = "管理员填写的中文原因";
    const ban = formatMultiplayerError(serverError({ code: "ACCOUNT_BANNED", until: Date.UTC(2100, 0, 1), reason } as { code: unknown }));
    assert.ok(ban.includes(reason));
    assert.equal(formatMultiplayerError("CUSTOM_SERVER_ERROR"), "CUSTOM_SERVER_ERROR");
    if (locale !== "zh-CN") {
      assert.ok(!/\p{Script=Han}/u.test(formatMultiplayerError("ROOM_FULL")));
      assert.ok(!/\p{Script=Han}/u.test(ban.replace(reason, "")));
      for (const source of Object.values(accountErrorMessages)) assert.notEqual(tr(source), source, source);
    }
  });
});

test("signed-in account panel translates its controls while retaining the player's nickname", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, async () => {
    const dom = installFakeDom();
    try {
      const account = { nickname: "中文昵称", admin: false };
      const dependencies = { createElement: (tag: string) => dom.document.createElement(tag),
        overlayStyle: "", panelStyle: "", styleButtons() {}, endpoint: () => "/admin", pageUrl: () => "https://kart.example" } as unknown as AccountChoiceDependencies;
      const result = chooseSignedInAccount(dependencies, dom.document.body as unknown as HTMLElement, account);
      assert.equal(dom.document.body.querySelector("input")!.value, account.nickname);
      const buttons = dom.document.body.querySelectorAll("button");
      assert.deepEqual(buttons.map(button => button.text()), [tr("进入多人大厅"), tr("修改昵称"), tr("退出账号"), tr("返回车库/单人游戏")]);
      buttons[0]!.click();
      assert.equal(await result, account);
    } finally { dom.restore(); }
  });
});

test("room dropdowns and controls translate without changing channel keys, room names or chat drafts", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, () => {
    const channels = roomChannelNames("ordinary", { speedIndiCombine: "个人竞速赛", speedTeamCombine: "组队竞速赛" }, {});
    assert.equal(roomChannelKey(channels.speedTeamCombine!, channels), "speedTeamCombine");
    assert.equal(channels.speedTeamCombine, tr("组队竞速赛"));
    assert.equal(roomChannelNames("item", {}, {}).itemTeamCombine, tr("组队道具赛"));
    const readyCalls: boolean[] = [];
    const host = { room: { name: "玩家命名的房间", hostId: "other", mode: "team", speed: 7, phase: "open",
      capacity: 8, members: [{ playerId: "me", name: "玩家昵称" }] },
      playerId: "me", busy: false, connected: true, chatSending: false, chatDraft: "玩家的聊天",
      actions: { ready: (ready: boolean) => readyCalls.push(ready), team() {}, leave() {} },
      countdownState: () => ({ active: false, remaining: 0, cancelLocked: false, elapsed: 0 }) } as unknown as LobbyRoomStateHost;
    const dependencies = { nodeName: (node: unknown) => (node as { name: string }).name,
      gameplayMode: () => "ordinary", slots: () => [], roadblockRunner: () => undefined } as unknown as LobbyRoomStateDependencies;
    const state = (name: string) => lobbyRoomNodeState(host, { name }, dependencies);
    assert.equal(state("roomName").text, "玩家命名的房间");
    assert.equal(state("gameType").text, tr("组队竞速赛"));
    assert.equal(state("ready").label, tr("准备"));
    (state("ready").action as () => void)();
    assert.deepEqual(readyCalls, [true]);
    assert.equal((state("채팅").input as { value: string }).value, "玩家的聊天");
  });
});

test("channel names from the original constants and random-track captions translate at display time", async () => {
  const ordinary = { speedIndiCombine: "个人标准", speedTeamCombine: "组队标准",
    speedIndiInfinit: "个人无限加速", speedTeamInfinit: "组队无限加速" };
  const rp = { speedIndiCombine: "标准个人RP", speedTeamCombine: "标准组队RP",
    speedIndiInfinit: "无限个人RP", speedTeamInfinit: "无限组队RP" };
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, async () => {
    for (const mode of ["ordinary", "rp"] as const) {
      const channels = roomChannelNames(mode, ordinary, rp);
      assert.deepEqual(Object.keys(channels), Object.keys(ordinary));
      if (locale !== "zh-CN") assert.ok(Object.values(channels).every(label => !/\p{Script=Han}/u.test(label)));
    }
    const host = { room: { randomTrackCode: 3 }, library: {}, actions: {}, disposed: false,
      trackLoad: 0, trackTitle: "", view: { render() {} } } as unknown as LobbyRoomTrackHost;
    const dependencies = { randomTrack: () => ({ code: "3", title: "人气随机（极易）", cardToken: "random" }),
      mode: () => "ordinary", uiResource: () => ({ bytes: async () => new Uint8Array() }),
      decodePng: async () => ({ width: 1, height: 1, pixels: [] }), canvas: () => ({}) } as unknown as LobbyRoomTrackDependencies;
    await loadLobbyRoomTrack(host, dependencies);
    assert.equal(host.trackTitle, tr("人气随机（极易）"));
    if (locale !== "zh-CN") assert.ok(!/\p{Script=Han}/u.test(host.trackTitle));
  });
});

test("original main-menu strings without English use translated fallbacks and retain native Korean", async () => {
  const rows = [{ c: "cn", v: "快速开始设置" }, { c: "kr", v: "빠른 시작 설정" }];
  for (const [locale, expected] of [["zh-CN", "快速开始设置"], ["en", "Quick Start settings"], ["ko", "빠른 시작 설정"]] as const)
    await withLocale(locale, () => assert.equal(resourceText(rows, (row, key) => row[key as keyof typeof row]), expected));
});

test("lobby authored translations retain named interpolation values", () => {
  const parameters = (text: string) => [...text.matchAll(/\{[a-z][a-zA-Z0-9]*\}/g)].map(match => match[0]).sort();
  for (const [source, [english, korean]] of Object.entries(lobbyTranslations)) {
    assert.deepEqual(parameters(english), parameters(source), source);
    assert.deepEqual(parameters(korean), parameters(source), source);
    assert.ok(!/\p{Script=Han}/u.test(english), source);
  }
});


test("server picker status and disconnect notices localize while protocol reasons stay stable", async () => {
  for (const locale of ["zh-CN", "en", "ko"] as const) await withLocale(locale, () => {
    const server = { nodeId: "node-a", name: "服务器自己的名称", origin: null, players: 8, rooms: 1, capacity: 8, full: true };
    const unavailable = gameServerUnavailableReason(server, "https://kart.example");
    assert.equal(unavailable, "已满");
    const summary = gameServerSummary({ server, unavailable });
    assert.ok(summary.includes(tr("已满")));
    assert.equal(LOBBY_SERVER.name, tr("多人大厅"));
    assert.equal(server.name, "服务器自己的名称");
    if (locale !== "zh-CN") {
      assert.ok(!/\p{Script=Han}/u.test(summary));
      assert.ok(!/\p{Script=Han}/u.test(cheatKickMessage({ check: "SPEED" })));
    }
  });
});
