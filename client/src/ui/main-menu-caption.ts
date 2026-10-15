import { gameLocale, tr } from "../i18n/locale";

interface CaptionRect { x: number; y: number; width: number; height: number }

// Longer titles start farther left in these release cards; cover their full text.
const STORY_TITLE_LEFT: Readonly<Record<string, number>> = {
  chapter_tomb: 42, chapter_penguin: 76, chapter_mabinogi: 98,
  chapter_olympos: 98, chapter_olympos2: 98,
  chapter_abyss: 98, chapter_abyss2: 98,
  chapter_northeu: 76, chapter_northeu2: 76, chapter_northeu3: 76,
  chapter_world: 98, chapter_world2: 98, chapter_jurassic: 98, chapter_1920y: 48,
};

/** Scenario cards bake their title into the upper-right of the 272×134 artwork. */
export function paintStoryCardCaption(context: CanvasRenderingContext2D, rect: CaptionRect,
  title: string, open: boolean, chapterName?: string): void {
  if (gameLocale() === "zh-CN") return;
  const left = chapterName ? STORY_TITLE_LEFT[chapterName] ?? 125 : 125;
  const box = { x: rect.x + rect.width * left / 272, y: rect.y + rect.height * 16 / 134,
    width: rect.width * (265 - left) / 272, height: rect.height * 70 / 134 };
  context.save();
  context.fillStyle = open ? "#e7e8eb" : "#b4b6ba";
  context.fillRect(box.x, box.y, box.width, box.height);
  let size = 16;
  let lines: string[] = [];
  const tokens = title.includes(" ") ? title.split(/\s+/) : Array.from(title);
  const separator = title.includes(" ") ? " " : "";
  do {
    context.font = `700 ${size}px system-ui, sans-serif`;
    lines = [];
    let line = "";
    for (const token of tokens) {
      const next = line ? line + separator + token : token;
      if (line && context.measureText(next).width > box.width - 10) {
        lines.push(line);
        line = token;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length * (size + 3) <= box.height - 6 || size <= 9) break;
    size--;
  } while (true);
  context.fillStyle = open ? "#273c58" : "#505764";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const top = box.y + (box.height - lines.length * (size + 3)) / 2;
  lines.forEach((line, index) => context.fillText(line, box.x + box.width / 2,
    top + (index + .5) * (size + 3), box.width - 10));
  context.restore();
}

/** The CN release stores category and mode names in its button textures. */
export function paintMainMenuCaption(context: CanvasRenderingContext2D, rect: CaptionRect,
  name: string, source: string | undefined, selected: boolean): void {
  if (gameLocale() === "zh-CN" || !source) return;
  const label = tr(source);
  let box: CaptionRect;
  let color = "#fff", background = "#125881", size = 17;
  if (name.startsWith("cat_")) {
    // Tall overview cards keep their character/icon art; short tabs keep the left icon.
    box = rect.height > 100
      ? { x: rect.x + 3, y: rect.y + rect.height * .77, width: rect.width - 6, height: rect.height * .22 }
      : { x: rect.x + 31, y: rect.y + 1, width: rect.width - 33, height: rect.height - 2 };
    background = selected ? "#d6efff" : "#fff";
    color = selected ? "#086eab" : "#253e4f";
    size = rect.height > 100 ? 15 : 12;
  } else if (name.startsWith("riderSchool_Level")) {
    box = { x: rect.x + 6, y: rect.y + rect.height * .23, width: rect.width * .78, height: rect.height * .51 };
    background = "#e9af17";
    color = "#382810";
    size = 23;
  } else {
    // The remaining mode cards put their title in the top-right strip.
    box = { x: rect.x + rect.width * .35, y: rect.y + rect.height * .11,
      width: rect.width * .63, height: rect.height * .29 };
    if (name.startsWith("trainingCenter")) background = "#448600";
    else if (name.startsWith("replay_") || name === "timeAttack_competitive") background = "#b77810";
    else if (name === "timeAttack_ranking") background = "#b72612";
  }
  context.save();
  context.fillStyle = background;
  context.fillRect(box.x, box.y, box.width, box.height);
  context.font = `700 ${size}px system-ui, sans-serif`;
  const available = Math.max(1, box.width - 8);
  const measured = context.measureText(label).width;
  if (measured > available) context.font = `700 ${Math.max(9, size * available / measured)}px system-ui, sans-serif`;
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, box.x + box.width / 2, box.y + box.height / 2, available);
  context.restore();
}
