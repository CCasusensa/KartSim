import { gameLocale } from "../i18n/locale";
import { itemDisplayName, itemNameSources } from "../i18n/item-names";

export interface GarageAppearanceName {
  id: string | number;
  family: string;
  title: string;
  slot?: string;
  effect?: string;
  icon?: string;
}

/** Localize the display copy; model, color, effect and equipment identity stay intact. */
export function localizeGarageAppearance<T extends GarageAppearanceName>(item: T,
  coating = false): T {
  const category = coating ? item.family === "xun" ? 76 : 68
    : item.slot === "boosterEffect" ? 78 : item.family === "xun" ? 77 : 69;
  const fallback = coating ? `${item.family === "xun" ? "迅 " : ""}车膜 ${item.id}`
    : item.slot === "boosterEffect" ? `喷焰 ${item.id} · ${item.effect}` : `车灯 ${item.id}`;
  const generated = item.title === fallback;
  const known = itemNameSources[`${category}:${item.id}`];
  let title = itemDisplayName(category, Number(item.id), generated && known ? known : item.title);
  if (generated && !known && gameLocale() !== "zh-CN") {
    const korean = gameLocale() === "ko";
    const label = coating ? korean ? "코팅" : "Coating"
      : item.slot === "boosterEffect" ? korean ? "부스터 효과" : "Booster Effect"
        : korean ? "테일램프" : "Tail Lamp";
    title = `${coating && item.family === "xun" ? "XUN " : ""}${label} ${item.id}`;
  }
  return { ...item, title };
}
