import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { addLobbyEmotionWheel, buildLobbyRoomTemplate,
  loadLobbyRoomTemplate, type RoomTemplateNode } from "./lobby-room-template";

const release = readFileSync(new URL("../../../recovered/formatted/index.js", import.meta.url), "utf8");
const start = release.indexOf("async function Ll0(");
const end = release.indexOf("\nclass py {", start);
assert.ok(start >= 0 && end > start);
const source = release.slice(start, end);

function node(tag: string, name?: string, children: RoomTemplateNode[] = [],
  extra: Record<string, string> = {}): RoomTemplateNode {
  return { name: tag, text: "", children,
    attributes: Object.entries({ ...(name === undefined ? {} : { name }),
      ...extra }).map(([field, value]) => ({ name: field, value })) };
}

function fixture(roadblock: boolean) {
  const root = node("Panel", "room", [
    node("Panel", "gameType", [], { visible: "false" }),
    node("Panel", "trackTheme", [], { texture: "old", color: "blue" }),
    node("TrackCard", "trackCard", [node("Skip", "skipInside")], {
      difficultyAlign: "center", difficultyAdjust: "2 4",
    }),
    node("Panel", "rider0", [node("Panel", "unused")]),
    node("Panel", "rider7"),
    node("Panel", "hidden", [], { visible: "false" }),
    node("Panel", "ready", [], { visible: "false" }),
    node("Panel", "요일모드"),
    node("Panel", "recording"),
    node("Skip", "skip"),
    node("Panel", "nested", [node("Panel", "keep")]),
    ...(roadblock ? [node("Panel", "roadBlockTime", [], {
      visible: "false",
    })] : []),
  ]);
  const card = node("Panel", "riderCard", [
    node("Label", "riderNameLabel"),
    node("Panel", "closed", [], { autoLoadImage: "true" }),
    node("Panel", undefined, [], { texture: "img_slotEmblemBG" }),
    node("Panel", "ready"),
    node("Panel", "runnerTag"), node("Panel", "blockerTag"),
    node("Panel", "runnerHandicap"),
  ], { riderRect: "1 2 3 4" });
  const difficulty = node("Panel", "difficulty", [
    node("Image", "star"), node("Image", "badge"),
  ]);
  const balloon = node("Panel", "talkBalloon", [
    node("Text", "message"), node("Text"),
  ]);
  const teams = [{ cardTexture: "red_card_1" },
    { cardTexture: "blue_card_1" }];
  return { root, card, difficulty, balloon, teams };
}

function dependencies(events: unknown[][] = []) {
  const attribute = (target: RoomTemplateNode, field: string) =>
    target.attributes.find(entry => entry.name === field)?.value;
  const clone = (target: RoomTemplateNode,
    changed: Record<string, string | undefined>,
    children = target.children): RoomTemplateNode => ({
      ...target,
      attributes: [
        ...target.attributes.filter(entry => !(entry.name in changed)),
        ...Object.entries(changed).map(([name, value]) => ({ name, value })),
      ],
      children,
    });
  const { root, card, teams, difficulty, balloon } = fixture(true);
  const loadDefinition = async (library: unknown, folder: string,
    name: string) => {
    events.push(["definition", library, folder, name]);
    if (name === "stage_window@zz") return root;
    if (name === "riderCard@zz") return card;
    if (name === "trackDifficulty") return difficulty;
    return balloon;
  };
  const loadRoleTeams = async (library: unknown) => {
    events.push(["teams", library]);
    return teams;
  };
  return { attribute, clone, loadDefinition, loadRoleTeams };
}

type Original = {
  Pl0(root: RoomTemplateNode, card: RoomTemplateNode,
    teams?: { cardTexture: string }[], difficulty?: RoomTemplateNode,
    balloon?: RoomTemplateNode, roadblock?: boolean):
    RoomTemplateNode | undefined;
  Fl0(root: RoomTemplateNode, emotions: { label: string }[]):
    RoomTemplateNode;
  Ll0(library: unknown, roadblock?: boolean):
    Promise<RoomTemplateNode | undefined>;
};

function original(deps: ReturnType<typeof dependencies>): Original {
  return new Function("T", "h2", "F9", "fa",
    `${source}\nreturn { Pl0, Fl0, Ll0 };`)(
      deps.attribute, deps.clone, deps.loadDefinition, deps.loadRoleTeams,
    ) as Original;
}

test("room template rider slots, filtering and roadblock layout match release", () => {
  const deps = dependencies();
  const releaseFns = original(deps);
  for (const roadblock of [false, true]) {
    const { root, card, teams, difficulty, balloon } = fixture(roadblock);
    assert.deepEqual(buildLobbyRoomTemplate(root, card, teams, difficulty,
      balloon, roadblock, deps),
    releaseFns.Pl0(root, card, teams, difficulty, balloon, roadblock),
    `roadblock=${roadblock}`);
  }
});

test("room template missing roadblock originals fail like release", () => {
  const deps = dependencies();
  const releaseFns = original(deps);
  const { root, card, teams, difficulty, balloon } = fixture(true);
  const cases = [
    { root, card: { ...card, children: card.children.filter(child =>
      deps.attribute(child, "name") !== "runnerTag") } },
    { root: { ...root, children: root.children.filter(child =>
      deps.attribute(child, "name") !== "roadBlockTime") }, card },
  ];
  for (const value of cases) {
    let expected = "";
    try { releaseFns.Pl0(value.root, value.card, teams, difficulty,
      balloon, true); } catch (error) { expected = (error as Error).message; }
    assert.ok(expected);
    assert.throws(() => buildLobbyRoomTemplate(value.root, value.card,
      teams, difficulty, balloon, true, deps), { message: expected });
  }
});

test("room template resources retain release concurrent fetch order", async () => {
  for (const rewritten of [false, true]) {
    const events: unknown[][] = [];
    const deps = dependencies(events);
    const library = { id: "library" };
    const result = rewritten
      ? await loadLobbyRoomTemplate(library, true, deps)
      : await original(deps).Ll0(library, true);
    if (!rewritten) {
      assert.deepEqual(events.map(event => event[0]),
        ["definition", "definition", "teams", "definition", "definition"]);
      const baseline = result;
      const modernEvents: unknown[][] = [];
      const modern = await loadLobbyRoomTemplate(library, true,
        dependencies(modernEvents));
      assert.deepEqual(modern, baseline);
      assert.deepEqual(modernEvents, events);
    }
  }
});

test("emotion wheel button layout and text match release", () => {
  const deps = dependencies();
  const releaseFns = original(deps);
  const { root } = fixture(false);
  for (const emotions of [[], [{ label: "笑" }],
    [{ label: "笑" }, { label: "哭" }, { label: "快" }]]) {
    assert.deepEqual(addLobbyEmotionWheel(root, emotions, deps),
      releaseFns.Fl0(root, emotions));
  }
});

test("root fullscreen untextured color panel (the dim over the lobby) is dropped", () => {
  const { card, difficulty, balloon, teams } = fixture(false);
  const dim = node("Panel", undefined, [], { windowRect: "fullscreen", color: "200 0 0 0",
    alphaBlend: "true" });
  const textured = node("Panel", undefined, [], { windowRect: "fullscreen", color: "white",
    texture: "img_mainSideBG" });
  const named = node("Panel", "shade", [], { windowRect: "fullscreen", color: "100 0 0 0" });
  const root = node("Container", undefined, [dim, textured, named, node("Panel", "rider0")],
    { windowRect: "fullscreen" });
  const result = buildLobbyRoomTemplate(root, card, teams, difficulty, balloon, false,
    dependencies())!;
  const kept = result.children.map(child =>
    child.attributes.find(field => field.name === "name")?.value ??
    child.attributes.find(field => field.name === "texture")?.value);
  assert.deepEqual(kept, ["img_mainSideBG", "shade", "rider0"]);
});

test("the 隊伍隨機分配 switch joins the header and 等待中 moves left for it", async () => {
  const { addLobbyRandomTeamToggle } = await import("./lobby-room-template");
  const deps = dependencies();
  const root = node("Container", "root", [
    node("Container", "header", [
      node("Label", "sessionStateStr", [], { leftTopWH: "800 0 150 50", textColor: "yellow" }),
      node("ImageButton", "changeRoomInfo", [], { leftTopTex: "1083 7" }),
    ]),
  ]);
  const result = addLobbyRandomTeamToggle(root, deps);
  const header = result.children[0]!;
  const state = header.children[0]!;
  assert.deepEqual(state.attributes.find(entry => entry.name === "leftTopWH"),
    { name: "leftTopWH", value: "650 0 160 50" });
  assert.ok(state.attributes.some(entry => entry.name === "textColor" && entry.value === "yellow"));
  assert.deepEqual(header.children[1], root.children[0]!.children[1]);
  const toggle = result.children.at(-1)!;
  assert.equal(toggle.name, "Panel");
  assert.deepEqual(toggle.attributes, [{ name: "name", value: "randomTeam" },
    { name: "leftTopWH", value: "942 68 250 36" }]);
  // The original tree is left alone.
  assert.equal(root.children[0]!.children[0]!.attributes.find(entry => entry.name === "leftTopWH")?.value,
    "800 0 150 50");
});

test("a 50人乱斗 room template holds 50 small seats in place of the cards", () => {
  const deps = dependencies();
  const { root, card, teams, difficulty, balloon } = fixture(false);
  const built = buildLobbyRoomTemplate(root, card, teams, difficulty, balloon, false, deps, true)!;
  const names = (target: RoomTemplateNode): string[] => [deps.attribute(target, "name") ?? "",
    ...target.children.flatMap(names)];
  const all = names(built);
  assert.equal(all.filter(name => /^rider\d+$/.test(name)).length, 50);
  assert.ok(all.includes("brawlSeats") && all.includes("rider49/aiHint") &&
    all.includes("rider0/riderNameLabel") && all.includes("rider12/closedHover"));
  const seats = built.children.find(child => deps.attribute(child, "name") === "brawlSeats")!;
  const rect = (index: number) => deps.attribute(seats.children[index]!, "leftTopWH");
  assert.equal(rect(0), "0 0 100 125");
  assert.equal(rect(11), "100 125 100 125");
  assert.equal(rect(49), "904 501 100 125");
  // Without the flag the release's cards stay.
  const release = buildLobbyRoomTemplate(root, card, teams, difficulty, balloon, false, deps)!;
  assert.ok(!names(release).includes("brawlSeats"));
});
