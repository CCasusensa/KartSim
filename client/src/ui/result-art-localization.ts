import { gameLocale, tr } from "../i18n/locale";

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

interface Caption { text: string; color?: string; size?: number; x?: number; y?: number; width?: number }
interface Sprite { image: CanvasImageSource; width: number; height: number }
const TEXT_ONLY: Readonly<Record<string, Caption>> = {
  ResultText: { text: "比赛结果", size: 28 },
  result_rankText: { text: "名次", size: 23 },
  victory: { text: "胜利", color: "#ffe134", size: 60 },
  perpect: { text: "完胜", color: "#ffe134", size: 35 },
  redWin: { text: "红队胜利！", color: "#ff5636", size: 46 },
  blueWin: { text: "蓝队胜利！", color: "#48caff", size: 46 },
  greenWin: { text: "绿队胜利！", color: "#83f031", size: 46 },
  yellowWin: { text: "黄队胜利！", color: "#ffdb39", size: 46 },
  gameresult_RunnerWin: { text: "跑者获胜！", color: "#ff5636", size: 44 },
  gameresult_RunnerLose: { text: "挡人方获胜！", color: "#48caff", size: 44 },
  rank_RunnerText: { text: "跑者", color: "#fff0a0", size: 35 },
  rank_BlockerText: { text: "挡人方", color: "#fff0a0", size: 35 },
  lap_RunnerText: { text: "实时圈数", color: "#fff0a0", size: 22, y: 32 },
  lap_BlockerText: { text: "跑者圈数", color: "#fff0a0", size: 22, y: 32 },
};

function caption(context: CanvasRenderingContext2D, sprite: Sprite, spec: Caption): void {
  const x = spec.x ?? sprite.width / 2, y = spec.y ?? sprite.height / 2;
  const width = spec.width ?? sprite.width - 12;
  context.font = `italic bold ${spec.size ?? 18}px 'Apple SD Gothic Neo', 'Malgun Gothic', 'Microsoft YaHei', sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, (spec.size ?? 18) / 12);
  context.strokeStyle = "#101928";
  context.fillStyle = spec.color ?? "#ffffff";
  context.strokeText(tr(spec.text), x, y, width);
  context.fillText(tr(spec.text), x, y, width);
}

/**
 * Repaint only baked lettering, retaining sprite dimensions and background art.
 * The 374×33 role strips keep their slanted tab and gradient. The 308×86
 * scoreboard keeps both colored boxes; its lettering is confined to y 0–28.
 */
export function paintLocalizedResultTexture(context: CanvasRenderingContext2D, sprite: Sprite,
  name: string): boolean {
  if (gameLocale() === "zh-CN" || name.endsWith("@kr")) return false;
  const base = name.replace(/@(?:cn|zz)$/, "");
  const spec = TEXT_ONLY[base];
  const header = base === "runnerHeader" || base === "blockerHeader";
  const score = /^scoreBox(?:_(blue|red|green|yellow))?$/.exec(base);
  if (!spec && !header && !score && base !== "lap_HandicapText") return false;
  context.save();
  context.clearRect(0, 0, sprite.width, sprite.height);
  if (spec) caption(context, sprite, spec);
  else {
    context.drawImage(sprite.image, 0, 0);
    if (header) {
      // A clean vertical stripe inside the colored tab replaces only the glyphs.
      context.clearRect(23, 3, 57, 27);
      context.drawImage(sprite.image, 21, 3, 1, 27, 23, 3, 57, 27);
      caption(context, sprite, { text: base === "runnerHeader" ? "跑者" : "挡人方", x: 51, y: 17, width: 62, size: 16 });
    } else if (score) {
      const teams = score[1] ? [score[1]] : ["blue", "red"];
      const width = sprite.width / teams.length;
      const labels: Record<string, string> = { blue: "蓝队", red: "红队", green: "绿队", yellow: "黄队" };
      teams.forEach((team, index) => {
        const left = index * width;
        context.clearRect(left, 0, width, 28);
        context.drawImage(sprite.image, left + 2, 0, 1, 28, left, 0, width, 28);
        caption(context, sprite, { text: labels[team!]!, x: left + width / 2, y: 14, width: width - 10, size: 17 });
      });
    } else {
      // Keep the prohibition icon and both pointed ends of the handicap strip.
      context.clearRect(63, 4, 99, 22);
      context.drawImage(sprite.image, 25, 4, 1, 22, 63, 4, 99, 22);
      caption(context, sprite, { text: "禁止使用R键", x: 111, y: 15, width: 94, size: 13, color: "#ffb1b1" });
    }
  }
  context.restore();
  return true;
}

/** Asset-loader projection: same extent, so original layout and pointer regions stay valid. */
export function localizeResultTexture(name: string, source: HTMLCanvasElement): HTMLCanvasElement {
  if (gameLocale() === "zh-CN" || name.endsWith("@kr")) return source;
  const base = name.replace(/@(?:cn|zz)$/, "");
  if (!TEXT_ONLY[base] && base !== "runnerHeader" && base !== "blockerHeader" &&
      base !== "lap_HandicapText" && !/^scoreBox(?:_(blue|red|green|yellow))?$/.test(base)) return source;
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d");
  return context && paintLocalizedResultTexture(context,
    { image: source, width: source.width, height: source.height }, name) ? output : source;
}
