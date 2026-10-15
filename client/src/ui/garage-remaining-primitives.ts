import { tr } from "../i18n/locale";
export function garageGameTypeAllowed(gameTypes: string | undefined,
  mode: string): boolean {
  return gameTypes === undefined ? true :
    gameTypes.split(";").some(value => value.trim() === mode);
}

export function garagePartCategoryId(slot: string,
  categories: Record<string, number>): number | undefined {
  return categories[slot];
}

export function garageStageLayout<Layout extends { width: number }>(
  width: number, layouts: Layout[]): Layout {
  const stage = layouts.find(layout => layout.width === width);
  if (!stage) throw new Error(`不支持的车库布局宽度：${width}`);
  return stage;
}

export interface GarageVisibleFunction<Vehicle> {
  visible(vehicle: Vehicle): boolean;
  [key: string]: unknown;
}

export function garageAvailableVehicleFunctions<Vehicle>(vehicle: Vehicle,
  catalog: GarageVisibleFunction<Vehicle>[]): Array<Record<string, unknown>> {
  return catalog.filter(effect => effect.visible(vehicle)).map(
    ({ visible: _visible, ...presentation }) => presentation);
}

export function garagePartCardLayoutForKind<Layout>(
  assets: { partCardLayouts: Map<string, Layout> }, kind: string):
  Layout | undefined {
  return assets.partCardLayouts.get(kind === "xun" ? "xun" : "classic");
}

export function garageNativeStatePath(base: string, suffix: string): string {
  return base.endsWith("@zz") ?
    `${base.slice(0, -3)}${suffix}@zz` : `${base}${suffix}`;
}

export function garageExpectedProgressionKind(kind: string): string {
  return kind === "classic" ? "classic" : kind;
}

export function garagePartPresentation(value: string | undefined,
  locked: boolean, fallback = tr("原装")) {
  return { value: value ?? fallback, state: locked ? tr("锁定") : "" };
}

export function garageFactoryAbilityDraft(abilities: number[],
  lookup: (id: number) => Record<string, unknown> | undefined):
  Array<Record<string, unknown>> {
  return abilities.map(id => lookup(id) ?? {});
}

export function garageFactorySignature(factory: {
  active: boolean; abilities: number[];
}): string {
  return `${factory.active ? 1 : 0}:${factory.abilities.join(",")}`;
}

export function garageClassicUpgradeLines(summary: {
  beforeLevel: number; afterLevel: number;
  beforePoints: number; afterPoints: number;
}): string[] {
  return [
    tr("等级 Lv.{0} → Lv.{1}", { "0": summary.beforeLevel, "1": summary.afterLevel }),
    tr("可用强化点 {0} → {1}", { "0": summary.beforePoints, "1": summary.afterPoints }),
  ];
}

export function garageNeedsLoadingLabel(resultOnly: boolean): boolean {
  return !resultOnly;
}

export function garageShowMaxPart(part: unknown, available: unknown[],
  enabled: boolean | undefined,
  isMaximum: (part: unknown, available: unknown[]) => boolean):
  boolean | undefined {
  return enabled && isMaximum(part, available);
}
