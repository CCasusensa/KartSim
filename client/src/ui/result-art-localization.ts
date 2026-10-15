import { gameLocale } from "../i18n/locale";

/** Caption-only textures inspected in the p3553 result and roadblock archives. */
const ROADBLOCK_NATIVE = new Set([
  "lap_RunnerText", "lap_BlockerText", "lap_HandicapText", "rank_RunnerText", "rank_BlockerText",
  "runnerHeader", "blockerHeader", "gameresult_RunnerWin", "gameresult_RunnerLose",
]);

/** The roadblock archive has Korean captions at the same design dimensions. */
export function localizedRoadblockTexture(name: string): string {
  const base = name.replace(/@(?:cn|zz|kr)$/, "");
  return gameLocale() === "ko" && ROADBLOCK_NATIVE.has(base) ? `${base}@kr` : name;
}
