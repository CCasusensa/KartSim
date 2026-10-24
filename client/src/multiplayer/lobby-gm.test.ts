import assert from "node:assert/strict";
import test from "node:test";
import { lobbyRoomNodeState, type LobbyRoomStateHost, type LobbyRoomStateDependencies } from "./lobby-room-state";
import { buildLobbyRoomTemplate, type RoomTemplateNode } from "./lobby-room-template";
import { tr } from "../i18n/locale";

const node = (name: string, children: RoomTemplateNode[] = []): RoomTemplateNode => ({
  name: "Panel", text: "", attributes: [{ name: "name", value: name }], children,
});
const attribute = (n: RoomTemplateNode, key: string) => n.attributes.find(a => a.name === key)?.value;
const clone = (n: RoomTemplateNode, changes: Record<string, string | undefined>, children = n.children) => ({
  ...n, children, attributes: Object.entries({ ...Object.fromEntries(n.attributes.map(a => [a.name, a.value])), ...changes })
    .filter(([, v]) => v !== undefined).map(([name, value]) => ({ name, value: value! })),
});

test("every normal and brawl seat includes a separate developer ribbon", () => {
  for (const brawl of [false, true]) {
    const root = node("root", Array.from({ length: 8 }, (_, i) => node(`rider${i}`)));
    const result = buildLobbyRoomTemplate(root, node("card", [node("bossTag_me"), node("ready")]),
      [], undefined, undefined, false, { attribute, clone }, brawl)!;
    const names: string[] = [];
    const visit = (n: RoomTemplateNode) => { names.push(attribute(n, "name") ?? ""); n.children.forEach(visit); };
    visit(result);
    assert.equal(names.filter(n => n.endsWith("/developerTag")).length, brawl ? 50 : 8);
    assert.ok(names.includes("rider0/bossTag_me"));
    assert.ok(names.includes("rider0/ready"));
  }
});

test("GM badge is independent of host and ready status and hidden for empty seats", () => {
  for (const gm of [true, false, undefined]) {
    for (const roomHost of [true, false]) {
      const member = { playerId: "p", name: "Player", gm, ready: true };
      const host = { playerId: "p", room: { hostId: roomHost ? "p" : "other", mode: "individual", phase: "open" },
        connected: true } as unknown as LobbyRoomStateHost;
      const deps = { nodeName: (n: unknown) => n as string, slots: () => [{ open: true, member }, { open: true }],
        roadblockRunner: () => undefined } as unknown as LobbyRoomStateDependencies;
      const state = (name: string) => lobbyRoomNodeState(host, name, deps);
      assert.equal(state("rider0/developerTag").visible, gm === true);
      assert.equal(state("rider0/bossTag_me").visible, roomHost);
      assert.equal(state("rider0/ready").visible, !roomHost);
      assert.equal(state("rider1/developerTag").visible, false);
    }
  }
});

test("developer badge supports all game languages", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const [language, expected] of [["zh-CN", "开发者"], ["en", "Developer"], ["ko", "개발자"]]) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => language } });
      assert.equal(tr("开发者"), expected);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("room protocol accepts optional boolean GM and rejects malformed flags", async () => {
  const { isValidRoomSnapshot } = await import("./room-validation");
  for (const gm of [undefined, true, false, "true", 1, null]) {
    const room = { roomId: "r", revision: 1, name: "Room", mode: "individual", capacity: 8,
      speedVersion: "国服", channelName: "speedIndiCombine", speed: 7, gameplay: "ordinary",
      resourceVersion: "p3553", hostId: "p", phase: "open", trackId: "village_R01",
      members: [{ playerId: "p", name: "Player", slot: 0, ready: false, team: null, gm }] };
    assert.equal(isValidRoomSnapshot(room), gm === undefined || typeof gm === "boolean");
  }
});
