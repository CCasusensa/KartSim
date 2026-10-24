import { tr } from "../i18n/locale";
/** Prepare the released lobby room scene for rider slots and mode controls. */

export interface RoomTemplateNode {
  name: string;
  children: RoomTemplateNode[];
  attributes: { name: string; value: string | undefined }[];
  [key: string]: unknown;
}

export interface RoomTemplateDependencies {
  attribute(node: RoomTemplateNode, name: string): string | undefined;
  clone(node: RoomTemplateNode, attributes: Record<string, string | undefined>,
    children?: RoomTemplateNode[]): RoomTemplateNode;
}

export interface TeamCardTemplate { cardTexture: string }

export interface RoomTemplateLoaderDependencies extends RoomTemplateDependencies {
  loadDefinition(library: unknown, folder: string, name: string):
    Promise<RoomTemplateNode>;
  loadRoleTeams(library: unknown): Promise<TeamCardTemplate[]>;
}

export async function loadLobbyRoomTemplate(library: unknown,
  roadblock: boolean, dependencies: RoomTemplateLoaderDependencies, brawl = false):
  Promise<RoomTemplateNode | undefined> {
  const [root, riderCard, teams, difficulty, talkBalloon] = await Promise.all([
    dependencies.loadDefinition(library, "stage_/mqReady", "stage_window@zz"),
    dependencies.loadDefinition(library, "stage_/mqReady", "riderCard@zz"),
    dependencies.loadRoleTeams(library),
    dependencies.loadDefinition(library, "gui_/windowTemplate", "trackDifficulty"),
    dependencies.loadDefinition(library, "stage_/mqReady", "talkBalloon@zz"),
  ]);
  return buildLobbyRoomTemplate(root, riderCard, teams, difficulty,
    talkBalloon, roadblock, dependencies, brawl);
}

/** A separate footer ribbon leaves the host/ready ribbon visible. */
function developerTag(prefix: string, compact = false): RoomTemplateNode {
  return { name: "Panel", text: "", children: [], attributes: Object.entries({
    name: prefix + "developerTag", leftTopWH: compact ? "0 0 68 14" : "0 0 128 22",
    align: "hcenter;bottom", adjust: compact ? "0 18" : "0 26",
  }).map(([name, value]) => ({ name, value })) };
}

const slotPartNames = new Set([
  "riderNameLabel", "bossTag_me", "bossTag_other", "ready", "changing",
  "closed", "kick", "info", "myRiderTag",
]);
const alwaysVisibleNames = new Set([
  "readyButtonCont", "teamReadyButtonCont", "ready", "cancel", "start",
  "start_count", "cancel_count", "autoCount", "changeRoomInfo",
  "changeRoomInfoNotPassword", "changeRoomInfoPassword",
]);

export function buildLobbyRoomTemplate(
  root: RoomTemplateNode, riderCard: RoomTemplateNode,
  teams: TeamCardTemplate[] = [], difficulty?: RoomTemplateNode,
  talkBalloon?: RoomTemplateNode, roadblock = false,
  dependencies?: RoomTemplateDependencies, brawl = false,
): RoomTemplateNode | undefined {
  if (!dependencies) throw new Error("Lobby room template dependencies are required");
  const { attribute, clone } = dependencies;
  if (roadblock) {
    for (const part of ["runnerTag", "blockerTag", "runnerHandicap"]) {
      if (!riderCard.children.some(child => attribute(child, "name") === part)) {
        throw new Error(tr("挡人房间缺少 {value} 原件。", { value: String(part) }));
      }
    }
    const hasRoadblockTime = (node: RoomTemplateNode): boolean =>
      attribute(node, "name") === "roadBlockTime" ||
      node.children.some(hasRoadblockTime);
    if (!hasRoadblockTime(root)) throw new Error(tr("挡人房间缺少限制时间原件。"));
  }

  const slotParts = riderCard.children.filter(node =>
    slotPartNames.has(attribute(node, "name") ?? "") ||
    attribute(node, "texture") === "img_slotEmblemBG");

  function transform(node: RoomTemplateNode): RoomTemplateNode | undefined {
    const name = attribute(node, "name") ?? "";
    if (node.name === "Skip") return undefined;
    // The root's untextured fullscreen color panel ("200 0 0 0"): a tint in
    // the original engine, a fill here, which would darken the lobby behind
    // the room (lobby-room-backdrop.ts). The original shows it undimmed.
    if (node.name === "Panel" && !name &&
      attribute(node, "windowRect") === "fullscreen" &&
      attribute(node, "color") && !attribute(node, "texture")) return undefined;
    const showHidden = alwaysVisibleNames.has(name) ||
      (roadblock && name === "roadBlockTime");
    if ((attribute(node, "visible") === "false" && !showHidden) ||
      name === "요일모드" || name === "recording") return undefined;

    if (name === "gameType") return clone(node, { leftTopWH: "454 0 150 50" });
    if (name === "roadBlockTime") return clone(node, { visible: "true" });
    if (name === "trackTheme") return {
      ...node, attributes: node.attributes.filter(part => part.name !== "texture"),
    };
    if (node.name === "TrackCard" && difficulty) {
      const label = clone(difficulty, {
        name: "roomTrackDifficulty", visible: "true",
        align: attribute(node, "difficultyAlign") as string,
        adjust: attribute(node, "difficultyAdjust") as string,
      }, difficulty.children.map(child => clone(child, {
        name: `roomTrackDifficulty/${attribute(child, "name")}`,
        resourceRoot: "gui_/windowTemplate",
      })));
      return { ...node, children: [...node.children, label] };
    }
    if (brawl && /^rider[0-7]$/.test(name)) {
      // 50人乱斗: the eight cards' area holds all 50 seats (brawlSeats).
      return name === "rider0" ? brawlSeats(node, riderCard, slotParts, { attribute, clone }) : undefined;
    }
    if (/^rider[0-7]$/.test(name)) {
      const prefix = `${name}/`;
      const clonedParts = slotParts.map((part, index) => {
        const partName = attribute(part, "name");
        if (partName === "closed") {
          const closedPanel = {
            ...part, name: "Panel",
            attributes: part.attributes.filter(field => field.name !== "autoLoadImage"),
          };
          return clone(closedPanel, { name: prefix + partName,
            texture: "btn_slotClose_1" });
        }
        return clone(part, { name: prefix +
          (partName ?? `emblemBackground${index}`) });
      });
      const slotBackground = (texture: string, hover = false) => clone(
        riderCard,
        { name: prefix + texture + (hover ? "Hover" : ""),
          texture: texture.replace(/_1$/, hover ? "_1" : "_2") }, []);
      const teamBackgrounds = teams.flatMap((team, index) =>
        [false, true].map(hover => clone(slotBackground(team.cardTexture, hover),
          { name: prefix + `teamBackground${index + 1}${hover ? "Hover" : ""}` })));
      const roadblockBackgrounds = roadblock
        ? ["red", "blue"].flatMap(color => [false, true].map(hover =>
          clone(slotBackground(`ridercard_${color}_roadBlock_1`, hover), {
            name: prefix + `roadBlockBackground/${color}${hover ? "Hover" : ""}`,
          })))
        : [];
      const roadblockCovers = roadblock
        ? ["red", "blue"].map(color =>
          clone(slotBackground(`ridercard_${color}_roadBlock_Cover`), {
            name: prefix + `roadBlockCover/${color}`,
          }))
        : [];
      const roadblockTags = roadblock
        ? ["runnerTag", "blockerTag", "runnerHandicap"].map(part =>
          clone(riderCard.children.find(child => attribute(child, "name") === part)!, {
            name: prefix + part, visible: "true",
            align: part === "runnerHandicap" ? "hcenter" : "right",
          }))
        : [];
      const preview: RoomTemplateNode = {
        name: "Panel", text: "",
        attributes: [
          { name: "name", value: prefix + "preview" },
          { name: "windowRect", value: attribute(riderCard, "riderRect") ??
            "-5 0 245 308" },
        ],
        children: [],
      };
      const teamCovers = teams.map((team, index) =>
        clone(slotBackground(team.cardTexture.replace(/1$/, "Cover")), {
          name: prefix + `teamCover${index + 1}`,
        }));
      const balloon = talkBalloon && clone(talkBalloon,
        { name: prefix + "talkBalloon", visible: "true" },
        talkBalloon.children.map(child => clone(child, {
          name: prefix + `talkBalloon/${attribute(child, "name") ?? "nametag"}`,
        })));
      const closed = clonedParts.find(part =>
        attribute(part, "name") === prefix + "closed");
      const partsAndHover = closed
        ? [...clonedParts, clone(closed, { name: prefix + "closedHover",
          texture: "btn_slotClose_2" })]
        : clonedParts;
      return { ...node, children: [
        slotBackground("btn_singleEmptySlot1_1"),
        slotBackground("btn_singleEmptySlot1_1", true),
        slotBackground("btn_singleSlot1_1"),
        slotBackground("btn_singleSlot1_1", true),
        ...teamBackgrounds, ...roadblockBackgrounds, preview,
        clone(slotBackground("btn_singleSlotCover"), {
          name: prefix + "singleCover" }),
        ...teamCovers, ...roadblockCovers, ...partsAndHover, ...roadblockTags,
        developerTag(prefix),
        ...(balloon ? [balloon] : []),
      ] };
    }
    return { ...node, children: node.children.map(transform).filter(
      (child): child is RoomTemplateNode => !!child) };
  }

  return transform(root);
}

/**
 * 隊伍隨機分配 (not in the release): the switch beside 房间设置 in the
 * header, painted by the room state (team rooms only); 等待中 moves left
 * to make room for it. Stage coordinates, like the emotion wheel.
 */
export function addLobbyRandomTeamToggle(root: RoomTemplateNode,
  dependencies: RoomTemplateDependencies): RoomTemplateNode {
  const { attribute, clone } = dependencies;
  const move = (node: RoomTemplateNode): RoomTemplateNode =>
    attribute(node, "name") === "sessionStateStr"
      ? clone(node, { leftTopWH: "650 0 160 50" })
      : { ...node, children: node.children.map(move) };
  const toggle: RoomTemplateNode = { name: "Panel", text: "",
    attributes: [{ name: "name", value: "randomTeam" },
      { name: "leftTopWH", value: "942 68 250 36" }], children: [] };
  const moved = move(root);
  return { ...moved, children: [...moved.children, toggle] };
}

/** Seat grid of a 50人乱斗 room: 10 × 5 cards at 40 % of the release's 251 × 313. */
export const BRAWL_SEAT_GRID = { columns: 10, rows: 5, width: 100, height: 125,
  stepX: 100.4, stepY: 125.2 } as const;

/**
 * The 50 seats of a 50人乱斗 room in place of the release's eight cards
 * (rider0 at the top left of the 4 × 2 card area, 1004 × 626): each seat
 * `rider<slot>` is a release card scaled to BRAWL_SEAT_GRID — its empty,
 * taken and closed backgrounds, cover, 3D preview, name, host, ready and
 * changing tags, own-rider frame and kick button — plus an "AI" hint for an
 * open seat, which an AI racer takes at the start. Emblems, the info button
 * and talk balloons do not fit and are left out.
 */
function brawlSeats(first: RoomTemplateNode, riderCard: RoomTemplateNode,
  slotParts: RoomTemplateNode[], dependencies: RoomTemplateDependencies): RoomTemplateNode {
  const { attribute, clone } = dependencies;
  const grid = BRAWL_SEAT_GRID;
  const part = (name: string) => slotParts.find(node => attribute(node, "name") === name);
  // A part moved to rect: its own position and size attributes dropped.
  const placed = (node: RoomTemplateNode, name: string, rect: string,
    extra: Record<string, string> = {}): RoomTemplateNode => ({
    ...node,
    attributes: [
      ...node.attributes.filter(field => !["name", "leftTopTex", "leftTopWH", "windowRect",
        "clientRect", "align", "adjust", "riderRect", "autoMultiTexture"].includes(field.name)),
      { name: "name", value: name }, { name: "leftTopWH", value: rect },
      ...Object.entries(extra).map(([field, value]) => ({ name: field, value })),
    ],
    children: [],
  });
  const full = `0 0 ${grid.width} ${grid.height}`;
  const seats = Array.from({ length: grid.columns * grid.rows }, (_, slot) => {
    const prefix = `rider${slot}/`;
    const background = (texture: string, hover = false) => placed(riderCard,
      prefix + texture + (hover ? "Hover" : ""), full,
      { texture: texture.replace(/_1$/, hover ? "_1" : "_2") });
    const children: RoomTemplateNode[] = [
      background("btn_singleEmptySlot1_1"), background("btn_singleEmptySlot1_1", true),
      background("btn_singleSlot1_1"), background("btn_singleSlot1_1", true),
      { name: "Panel", text: "", attributes: [{ name: "name", value: prefix + "preview" },
        { name: "windowRect", value: `-2 0 ${grid.width - 2} ${grid.height - 2}` }], children: [] },
      placed(riderCard, prefix + "singleCover", full, { texture: "btn_singleSlotCover" }),
    ];
    const closed = part("closed");
    if (closed) {
      const panel = { ...closed, name: "Panel",
        attributes: closed.attributes.filter(field => field.name !== "autoLoadImage") };
      children.push(placed(panel, prefix + "closed", full, { texture: "btn_slotClose_1" }),
        placed(panel, prefix + "closedHover", full, { texture: "btn_slotClose_2" }));
    }
    for (const tag of ["bossTag_me", "bossTag_other", "ready", "changing"]) {
      const node = part(tag);
      if (node) children.push(placed(node, prefix + tag, `0 ${grid.height - 18} ${grid.width} 18`));
    }
    children.push(developerTag(prefix, true));
    const frame = part("myRiderTag");
    if (frame) children.push(placed(frame, prefix + "myRiderTag", full));
    const label = part("riderNameLabel");
    if (label) children.push(placed(label, prefix + "riderNameLabel", `0 1 ${grid.width} 15`,
      { textRender: "outline12", marginRect: "0 0 0 0" }));
    children.push({ name: "Label", text: "", attributes: [
      { name: "name", value: prefix + "aiHint" },
      { name: "leftTopWH", value: `0 ${grid.height / 2 - 12} ${grid.width} 24` },
      { name: "text", value: "AI" }, { name: "textRender", value: "outline16" },
      { name: "textColor", value: "255 150 168 196" }, { name: "textAlign", value: "center" },
    ], children: [] });
    // An ImageButton draws its icon unscaled, centred: bottom right of the preview.
    const kick = part("kick");
    if (kick) children.push(placed(kick, prefix + "kick", `${grid.width - 24} ${grid.height - 43} 24 24`));
    return { name: "Container", text: "", attributes: [
      { name: "name", value: `rider${slot}` },
      { name: "leftTopWH", value: `${Math.round((slot % grid.columns) * grid.stepX)} ` +
        `${Math.round(Math.floor(slot / grid.columns) * grid.stepY)} ${grid.width} ${grid.height}` },
    ], children };
  });
  return clone(first, { name: "brawlSeats", leftTopWH: "0 0 1004 626" }, seats);
}

export function addLobbyEmotionWheel(root: RoomTemplateNode,
  emotions: { label: string }[], dependencies: RoomTemplateDependencies):
  RoomTemplateNode {
  const element = (tag: string, name: string, rect: string, text?: string,
    children: RoomTemplateNode[] = []): RoomTemplateNode => ({
    name: tag, text: "",
    attributes: Object.entries({
      name, leftTopWH: rect,
      ...(text === undefined ? {} : { text, textRender: "bold16" }),
    }).map(([field, value]) => ({ name: field, value })),
    children,
  });
  const buttons = emotions.map((emotion, index) => element("TextButton",
    `roomEmotion/${index}`,
    `${8 + (index % 2) * 122} ${8 + Math.floor(index / 2) * 40} 116 34`,
    `${index + 1} ${emotion.label}`));
  const wheel = dependencies.clone(element("Panel", "roomEmotionWheel",
    "214 566 252 176", undefined, buttons), { color: "232 23 44 77" });
  return { ...root, children: [
    ...root.children, wheel,
    element("TextButton", "roomEmotionToggle", "368 744 98 34", tr("表情")),
  ] };
}
