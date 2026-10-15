import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { myRoomAdminKartChoices } from "../ui/my-room-admin";
import { licenseLock, licenseName, channelLicenseWarning } from "../license/license-model";
import { licenseErrorMessage, type LicenseState } from "../license/license-api";
import { tr } from "./locale";
import { drawTaskbarButton, taskbarButtonLabel, type TaskbarButton, type TaskbarImage } from "../ui/taskbar";
import { localizeMiniNotice } from "../menus/noticer";
import { claimedMessage, rewardTitle, storageLeft } from "../menus/reward-box-screen";
import { formatMyRoomString, readMyRoomStringBag, type MyRoomHudNode } from "../ui/my-room-hud";
import { rankedEntries, settingsLabel } from "../timeattack/ready-replays";
import { formatRaceReward } from "../account/rewards";
import { randomTrackGroupName, selectReadyOption } from "../ui/ready-options";
import { formatNetStats } from "../ui/hud-overlay";
import { timeAttackErrorMessage } from "../timeattack/timeattack-api";
import { storyStepResult } from "../timeattack/ready-story";

function withLocale(locale: string, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
const button: TaskbarButton = { node: {}, name: "multiplay", rect: { x: 100, y: 0, width: 104, height: 66 } };
const image: TaskbarImage = { image: {} as CanvasImageSource, width: 104, height: 66 };

test("tray sprites render whole in all three languages without runtime caption overlays", () => {
  for (const [locale, label] of [["zh-CN", "多人游戏"], ["en", "Multiplayer"], ["ko", "멀티 플레이"]] as const) {
    withLocale(locale, () => {
      const images: unknown[][] = [], captions: unknown[][] = [];
      const context = { drawImage: (...args: unknown[]) => images.push(args),
        fillText: (...args: unknown[]) => captions.push(args), save() {}, restore() {} } as unknown as CanvasRenderingContext2D;
      drawTaskbarButton(context, image, button);
      assert.equal(taskbarButtonLabel("multiplay", "多人游戏"), label);
      assert.deepEqual(images[0], [image.image, 100, 0]);
      assert.equal(captions.length, 0);
      captions.length = 0;
      drawTaskbarButton(context, image, { ...button, name: "messengerButton" });
      assert.equal(captions.length, 0, "icon-only tray buttons retain artwork");
    });
  }
});

test("service reminders translate counts while authored announcements remain intact", () => {
  const source = { title: "奖励箱", kind: "rewardBox",
    message: "奖励箱中有2个道具。|保管的道具在保管时间结束后将自动删除，请在到期前领取道具。" };
  const announcement = { title: "活动", kind: "notice", message: "中文公告和车手昵称保持原样" };
  for (const [locale, title, message] of [
    ["zh-CN", "奖励箱", source.message],
    ["en", "Reward Box", "Your Reward Box has 2 item(s).|Claim them before they expire. Unclaimed items are automatically deleted."],
    ["ko", "보상함", "보상함에 아이템이 2개 있습니다.|보관 기간이 지나면 자동 삭제됩니다. 만료 전에 수령하세요."],
  ] as const) withLocale(locale, () => {
    assert.deepEqual(localizeMiniNotice(source), { ...source, title, message });
    assert.equal(localizeMiniNotice(announcement), announcement);
    const quest = localizeMiniNotice({ title: "有正在进行的任务。", kind: "quest",
      message: "还有3个任务可以进行，|点击任务按钮查看详情。" });
    assert.ok(quest.message.includes("3"));
    if (locale !== "zh-CN") assert.doesNotMatch(quest.message, /[\p{Script=Han}]/u);
  });
});

test("reward units, currencies and claim notices switch languages without translating item names", () => {
  for (const [locale, currency, duration] of [["zh-CN", "点券", "2天"], ["en", "Coupons", "2d"], ["ko", "포인트", "2일"]] as const) {
    withLocale(locale, () => {
      assert.equal(storageLeft(2 * 86_400_000, 0), duration);
      assert.equal(rewardTitle({ name: "点券", count: 500, currency: "coupon" }), locale === "zh-CN" ? "500点券" : `500 ${currency}`);
      assert.equal(rewardTitle({ name: "活动", count: 1 }), "活动");
      const claimed = claimedMessage(["活动"]);
      assert.ok(claimed.includes("活动"));
      assert.ok(claimed.startsWith(locale === "en" ? "Claimed:" : locale === "ko" ? "수령 완료:" : "已成功领取："));
      assert.equal(tr("数量：{count}个|使用期限：{duration}", { count: 2, duration: "∞" }),
        locale === "en" ? "Quantity: 2|Duration: ∞" : locale === "ko" ? "수량: 2개|사용 기간: ∞" : "数量：2个|使用期限：∞");
    });
  }
});

test("My Room handles empty locale entries and inserts rider names after translating templates", () => {
  const node = (name: string, values: Record<string, string>, children: MyRoomHudNode[] = []): MyRoomHudNode => ({ name,
    attributes: Object.entries(values).map(([name, value]) => ({ name, value })), children });
  const bag = node("StringBag", {}, [node("k", { n: "room" }, [node("m", { c: "cn", v: "小屋" }),
    node("m", { c: "en", v: "" }), node("m", { c: "kr", v: "" })])]);
  for (const [locale, room, message] of [["zh-CN", "小屋", "商店进入小屋"], ["en", "My Room", "商店 entered the room"],
    ["ko", "마이룸", "商店님이 입장했습니다"]] as const) withLocale(locale, () => {
    assert.equal(readMyRoomStringBag(bag).get("room"), room);
    const nativeBag = node("StringBag", {}, [node("k", { n: "native" }, [node("m", { c: "cn", v: "原版中文" }),
      node("m", { c: "us", v: "Native English" }), node("m", { c: "kr", v: "원본 한국어" })])]);
    assert.equal(readMyRoomStringBag(nativeBag).get("native"), locale === "en" ? "Native English" : locale === "ko" ? "원본 한국어" : "原版中文");
    assert.equal(formatMyRoomString("%s进入小屋", "商店"), message);
  });
});

test("single-player settings, results and ranked replay cards follow the locale while rider names remain intact", () => {
  for (const [locale, settings, success] of [["zh-CN", "标准速度 / 个人赛", "任务成功！"],
    ["en", "Standard / Solo", "Mission complete!"], ["ko", "표준 속도 / 개인전", "미션 성공!"]] as const) {
    withLocale(locale, () => {
      assert.equal(settingsLabel(7, 0), settings);
      const result = storyStepResult({ kind: "TimeAttack", track: "test", laps: 1, timeLimitMs: 0, speed: 0 },
        { finished: true, elapsedMs: 3000 }, 0);
      assert.equal(result.message, success);
      const [card] = rankedEntries([{ rank: 1, accountId: "a", nickname: "商店", kartName: "自己的车",
        bestMs: 3000, updatedAt: 0, hasReplay: true, self: true }],
      { track: { id: "test", path: "test", title: "自定义地图" }, speed: 7, booster: 0 });
      assert.equal(card?.riderName, "商店");
      assert.equal(card?.displayRiderName, locale === "zh-CN" ? "商店（我）" : locale === "en" ? "商店 (Me)" : "商店 (나)");
      assert.equal(card?.trackTitle, "自定义地图");
      assert.equal(card?.kartName, "自己的车");
    });
  }
});


test("race rewards, random track choices, replay errors and network status follow the locale", () => {
  for (const [locale, random, rewards, latency, error] of [
    ["zh-CN", "人气随机（极易）", "+25经验 +100金币 +3点券 +2K币", "延迟 23 ms  FPS 60", "该纪录没有可观看的录像。"],
    ["en", "Popular Random (Very Easy)", "+25 EXP +100 Lucci +3 Coupons +2 K-Coins", "Latency 23 ms  FPS 60", "No replay is available for this record."],
    ["ko", "인기 랜덤 (매우 쉬움)", "+25 경험치 +100 루찌 +3 포인트 +2 K코인", "지연 23 ms  FPS 60", "이 기록에는 시청 가능한 리플레이가 없습니다."],
  ] as const) withLocale(locale, () => {
    assert.equal(randomTrackGroupName({ randomType: "hot1", cardToken: "speedAllRandom_TimeAttack@zz" }), random);
    assert.equal(randomTrackGroupName({ randomType: "custom:商店" }), "custom:商店");
    const selected = selectReadyOption({ version: "国服", speed: 7, booster: 0, showGhost: false }, "S4");
    assert.equal(selected.speed, 4);
    assert.equal(selected.version, "国服");
    assert.equal(formatRaceReward({ exp: 25, lucci: 100, coupon: 3, koin: 2 }), rewards);
    assert.equal(formatNetStats(23, 60, "自定义节点"), `自定义节点  ${latency}`);
    assert.equal(timeAttackErrorMessage(new Error("REPLAY_NOT_FOUND")), error);
  });
});


test("room empty choices and license locks and lesson menu titles translate at display time", () => {
  const table = JSON.parse(readFileSync(new URL("../../../server-go/internal/data/license/license.json", import.meta.url), "utf8")) as { licenses: Array<{ steps: Array<{ name: string; step: number }> }> };
  const before = JSON.stringify(table);
  for (const [locale, none, rookie] of [["zh-CN", "不选择", "初级"], ["en", "None", "Rookie"],
    ["ko", "선택 안 함", "루키"]] as const) withLocale(locale, () => {
    const customKart = { item: { category: 3, itemId: 1, serial: 0 }, title: "不选择" };
    const choices = myRoomAdminKartChoices([customKart]);
    assert.equal(choices[0]?.label, none);
    assert.equal(choices[1]?.label, customKart.title);
    assert.equal(licenseName(2), rookie);
    const state = { baseLevel: 1, tryLevel: 1 } as LicenseState;
    const messages = [licenseLock(state, 2)!, channelLicenseWarning("speedTeamInfinit", 0) ?? "",
      licenseErrorMessage("LICENSE_INCOMPLETE"), ...table.licenses.flatMap(level => level.steps.map(step => tr(step.name)))];
    assert.ok(messages[0]?.length);
    if (locale !== "zh-CN") assert.ok(messages.every(value => !/\p{Script=Han}/u.test(value)), messages.join("\n"));
  });
  assert.equal(JSON.stringify(table), before);
});
