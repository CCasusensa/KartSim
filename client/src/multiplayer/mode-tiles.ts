import { tr } from "../i18n/locale";
/** Mode cards positioned on the multiplayer lobby's 1600×900 canvas. */
export const multiplayerModeTiles = [
  { name: "ordinaryRace", label: tr("普通竞速"), image: "ordinary-race.png",
    gameplay: "ordinary", x: 0, y: 0 },
  { name: "gripRace", label: tr("抓地模式"), image: "grip-mode.png",
    gameplay: "grip", x: 278, y: 0 },
  { name: "shadowRace", label: tr("幽灵模式"), image: "ghost-mode.png",
    gameplay: "shadow", x: 0, y: 138 },
  { name: "blockingRace", label: tr("挡人模式"), image: "blocking-mode.png",
    gameplay: "roadblock", x: 278, y: 138 },
  { name: "giantRace", label: tr("巨人模式"), image: "giant-mode.png",
    gameplay: "giant", x: 0, y: 276 },
  { name: "rpRace", label: tr("RP竞速"), image: "cn_스피드복불복개인전_0",
    resourceRoot: "zeta_/cn/stage/mainMenu", editedImage: "rp-race-neutral-0",
    gameplay: "rp", x: 278, y: 276 },
] as const;
