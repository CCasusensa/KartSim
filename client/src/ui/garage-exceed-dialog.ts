import { node, nodeName, type BmlLibrary, type Node, type NodeState } from "./bml-kit";
import { confirmGame } from "./game-popups";
import { openGarageReleaseWindow, type GarageReleaseWindow,
  type OpenGarageReleaseWindow } from "./garage-release-window";

export type GarageExceedChoice = 2 | 3 | 4 | "random";

export interface GarageExceedDialogAssets {
  exceedTypes?: Map<number, { textureType: number; accelLevel: number; timeLevel: number }>;
  urls: Map<string, string>;
}

export interface GarageExceedDialogDependencies {
  resolveChoice(choice: GarageExceedChoice): number;
  /** Left from the HTML dialog; the generated wiring still passes them. */
  styleAction?(button: HTMLButtonElement, style: unknown, kind: "primary" | "secondary"): void;
  loadStyles?(library: unknown): Promise<unknown>;
  /** The release window (te.load in a popup layer over the game area). */
  openWindow?: OpenGarageReleaseWindow;
  /** The 变更超负荷类型 question (the release message box). */
  confirm?(title: string, message: string, options: { library: unknown; signal: AbortSignal }): Promise<boolean>;
}

/**
 * 超负荷类型变更 drawn by the release window renderer, from
 * dialog2_exceedTypeChange.rho exceedTypeChange@zz: the 564×535
 * CaptionDialog of its exceedTypeChangeCheck / Result panels with the
 * tuning_changeExceedPopupBg2 board, 变更车辆 + the kart name over the
 * garage picture (exceedTypeChangeResult), the type icons with the
 * tuning_arrow_b arrow between them (selectedIngredientCheck), the
 * 超负荷加速度 / 超负荷时间 gauges with tuning_arrow_b_s between them
 * (the main window's selectedIngredient rows) and the 确定 / 取消
 * TextButtons (changeOkButton / changeCancelButton). The release picks a
 * material kart in the main window's kart list; here the four choices (S,
 * B, L, 随机) sit over the garage picture as dialog2_kart12SkillTuning skill
 * cards (tuning_selectperform_slotBg_s / _c / _c_effect). 确定 asks again
 * in the release message box before the type changes.
 */

const FOLDER = "dialog2_/exceedTypeChange";
const ROOTS = [FOLDER, "dialog2_/kart12SkillTuning", "stage_/common"];

/** exceedTypeChange_stringBag (cn). */
export const EXCEED_STRINGS = {
  caption: "超负荷类型变更",
  targetKart: "变更车辆",
  type: "类型",
  exceedAccel: "超负荷加速度",
  exceedTime: "超负荷时间",
};

export const EXCEED_CHOICES: readonly GarageExceedChoice[] = [2, 3, 4, "random"];
/** The type whose icon stands for 随机 (icon_exceedB_5, the question mark). */
const RANDOM_TYPE = 5;
const TYPE_NAMES = new Map([[2, "S"], [3, "B"], [4, "L"], [RANDOM_TYPE, "随机"]]);

/** The release layout's text outline colour (a r g b). */
const OUTLINE = "255 42 55 80";

const label = (name: string, rect: string, text: string, textRender: string, textColor: string,
  textAlign = "center"): Node =>
  node("Label", { name, leftTopWH: rect, text, textAlign, textRender, textColor, textColor2: OUTLINE });

/** One icon per texture, shown only while it is the one asked for. */
const icons = (prefix: string, textures: number[], rect: string): Node[] =>
  [...new Set(textures)].map(texture => node("Panel", { name: `${prefix}${texture}`, leftTopWH: rect,
    texture: `icon_exceedB_${texture}`, alphaBlend: "true" }));

/** The gauge for each level (tuning_exceedProgressbar_00 empty … _03 full). */
const gauges = (prefix: string, x: number, y: number): Node[] => [0, 1, 2, 3].map(level =>
  node("Panel", { name: `${prefix}${level}`, leftTopWH: `${x} ${y} 158 14`,
    texture: `tuning_exceedProgressbar_0${level}`, alphaBlend: "true" }));

/** The chooser window; `textures` are the icon textures it may show. */
export function exceedChoiceDefinition(textures: { current: number; choices: number[] }): Node {
  const card = (index: number, texture: number) => node("Panel", {
    name: `choice${index}`, leftTopWH: `${index * 128} 0 116 116`, texture: "tuning_selectperform_slotBg_s",
    alphaBlend: "true",
  }, [
    node("Panel", { name: `choiceHover${index}`, leftTopWH: "0 0 116 116", texture: "tuning_selectperform_slotBg_c",
      alphaBlend: "true" }),
    node("Panel", { name: `choiceIcon${index}`, leftTopWH: "20 18 76 76", texture: `icon_exceedB_${texture}`,
      alphaBlend: "true" }),
    node("Panel", { name: `choiceEffect${index}`, leftTopWH: "0 0 116 116",
      texture: "tuning_selectperform_slotBg_c_effect", alphaBlend: "true" }),
    label(`choiceName${index}`, "0 120 116 24", "", "outline16", "white"),
  ]);
  const row = (name: string, y: number, text: string) => [
    label(`${name}Caption`, `24 ${y - 7} 112 28`, text, "bold14", "white", "left,vcenter"),
    ...gauges(`${name}Current`, 138, y),
    node("CharPanel", { name: `${name}Arrow`, leftTopWH: `304 ${y - 3} 52 20`, fontSize: "52 20", fontStr: "012",
      text: "1", texture: "tuning_arrow_b_s", alphaBlend: "true" }),
    ...gauges(`${name}New`, 364, y),
    node("Panel", { name: `${name}Random`, leftTopWH: `424 ${y - 11} 35 35`, texture: "icon_exceedS_random",
      alphaBlend: "true" }),
  ];
  const typeIcons = [...new Set([textures.current, ...textures.choices])];
  return node("Panel", { windowRect: "fullscreen", color: "100 0 0 0", alphaBlend: "true" }, [
    node("CaptionWindow", { name: "exceedTypeChoice", windowRect: "0 0 564 535", align: "center", adjust: "0 -40",
      frame: "CaptionDialog", caption: EXCEED_STRINGS.caption, setCloseButton: "closeButton" }, [
      node("ImageBoard", { leftTopWH: "-11 -1 550 535", image: "tuning_changeExceedPopupBg2", alphaBlend: "true" }, [
        label("targetCaption", "175 25 200 25", EXCEED_STRINGS.targetKart, "outline14", "255 198 233 251"),
        label("kartName", "35 45 480 25", "", "outline16", "white"),
        node("Container", { name: "choices", leftTopWH: "25 82 500 146" },
          textures.choices.map((texture, index) => card(index, texture))),
        label("choosePrompt", "75 268 400 30", "请选择超负荷类型", "bold16", "255 187 198 215"),
        node("Container", { name: "compare", leftTopWH: "15 244 520 110" }, [
          ...icons("currentType", typeIcons, "106 5 76 76"),
          label("currentCaption", "84 78 120 25", `当前${EXCEED_STRINGS.type}`, "outline16", "white"),
          node("CharPanel", { name: "compareArrow", leftTopWH: "224 32 72 28", fontSize: "72 28", fontStr: "012",
            text: "1", texture: "tuning_arrow_b", alphaBlend: "true" }),
          ...icons("newType", typeIcons, "338 5 76 76"),
          label("newCaption", "316 78 120 25", `变更${EXCEED_STRINGS.type}`, "outline16", "white"),
        ]),
        ...row("accel", 380, EXCEED_STRINGS.exceedAccel),
        ...row("time", 420, EXCEED_STRINGS.exceedTime),
        node("TextButton", { name: "okButton", leftTopWH: "122 478 146 42", text: "确定", textRender: "bold16",
          textColor: "white", overTextColor: "white", clickedTextColor: "255 24 55 104",
          disabledTextColor: "255 220 220 220" }),
        node("TextButton", { name: "cancelButton", leftTopWH: "280 478 146 42", text: "取消",
          textColor: "255 64 75 95", textRender: "bold16", overTextColor: "255 106 120 147",
          overTextRender: "bold16", clickedTextColor: "255 34 41 52", clickedTextRender: "bold16",
          disabledTextColor: "255 131 131 131", disabledTextRender: "bold16" }),
      ]),
    ]),
  ]);
}

/** The Garage Exceed Type chooser and its confirmation. */
export class GarageExceedTypeDialog {
  selected?: GarageExceedChoice;
  disposed = false;
  /** The 变更超负荷类型 question is up. */
  confirming = false;
  window?: GarageReleaseWindow;
  readonly previousFocus = typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement
    ? document.activeElement : undefined;
  readonly question = new AbortController();
  /** The choice cards as the renderer hands them to state(), for the hover look. */
  readonly cards = new Map<number, unknown>();

  constructor(_surface: HTMLElement, readonly assets: GarageExceedDialogAssets,
    readonly library: unknown, readonly current: { title: string; type: number },
    readonly onClose: (selected?: number) => void,
    readonly dependencies: GarageExceedDialogDependencies) {
    void this.open();
  }

  textureOf(type: number): number {
    return this.assets.exceedTypes?.get(type)?.textureType ?? type;
  }

  typeName(type: number): string {
    return TYPE_NAMES.get(type) ?? `类型 ${type}`;
  }

  choiceType(choice: GarageExceedChoice): number {
    return choice === "random" ? RANDOM_TYPE : choice;
  }

  async open(): Promise<void> {
    const definition = exceedChoiceDefinition({
      current: this.textureOf(this.current.type),
      choices: EXCEED_CHOICES.map(choice => this.textureOf(this.choiceType(choice))),
    });
    try {
      const window = await (this.dependencies.openWindow ?? openGarageReleaseWindow)({
        library: this.library, definition, roots: ROOTS, closeButtonFolder: FOLDER, label: "选择超负荷类型",
        onCancel: () => { if (!this.confirming) this.close(undefined); },
        state: entry => this.state(entry),
      });
      if (this.disposed) {
        window.dispose();
        return;
      }
      this.window = window;
      window.render();
      window.focus("cancelButton");
    } catch (error) {
      console.error("超负荷类型窗口打开失败", error);
      this.close(undefined);
    }
  }

  /** What each node of the window shows. */
  state(entry: Node): NodeState {
    const name = nodeName(entry);
    const record = (type: number) => this.assets.exceedTypes?.get(type);
    const current = record(this.current.type);
    const chosen = this.selected === undefined || this.selected === "random" ? undefined : record(this.selected);
    const card = /^choice(Hover|Icon|Effect|Name)?(\d)$/.exec(name);
    if (card) {
      const index = Number(card[2]);
      const choice = EXCEED_CHOICES[index]!;
      const picked = this.selected === choice;
      switch (card[1]) {
        case undefined:
          this.cards.set(index, entry);
          return { label: choice === "random" ? "随机（在 S / B / L 中随机选择）" : this.typeName(choice),
            checked: picked, disabled: this.confirming, action: () => this.choose(choice) };
        case "Hover": {
          const face = this.cards.get(index);
          return { visible: picked || (face !== undefined && this.window?.hovered === face) };
        }
        case "Effect": return { visible: picked };
        case "Name": return { text: this.typeName(this.choiceType(choice)) };
      }
      return {};
    }
    const typeIcon = /^(current|new)Type(\d+)$/.exec(name);
    if (typeIcon) {
      const texture = typeIcon[1] === "current" ? this.textureOf(this.current.type)
        : this.selected === undefined ? undefined : this.textureOf(this.choiceType(this.selected));
      return { visible: Number(typeIcon[2]) === texture };
    }
    const gauge = /^(accel|time)(Current|New)(\d)$/.exec(name);
    if (gauge) {
      const source = gauge[2] === "Current" ? current : chosen;
      const level = source ? gauge[1] === "accel" ? source.accelLevel : source.timeLevel : 0;
      return { visible: Number(gauge[3]) === level };
    }
    switch (name) {
      case "exceedTypeChoice": return { text: EXCEED_STRINGS.caption };
      case "kartName": return { text: this.current.title };
      case "choosePrompt": return { visible: this.selected === undefined };
      case "compare": return { visible: this.selected !== undefined };
      case "accelRandom":
      case "timeRandom": return { visible: this.selected === "random" };
      case "okButton": return { text: "确定", label: "确定变更超负荷类型",
        disabled: this.selected === undefined || this.confirming,
        action: () => { if (this.selected !== undefined) this.showConfirmation(this.selected); } };
      case "cancelButton": return { text: "取消", label: "取消", disabled: this.confirming,
        action: () => this.close(undefined) };
      case "closeButton": return { label: "关闭超负荷类型选择", disabled: this.confirming,
        action: () => this.close(undefined) };
    }
    return {};
  }

  choose(choice: GarageExceedChoice): void {
    if (this.disposed || this.confirming) return;
    this.selected = choice;
    this.window?.render();
  }

  confirmationText(choice: GarageExceedChoice): string {
    return choice === "random"
      ? "将随机变更超负荷类型。|确定继续吗？"
      : `确定将当前车辆的超负荷类型变更为 ${this.typeName(choice)} 吗？`;
  }

  /** 变更超负荷类型 in the release message box: 确定 changes the type, 取消 returns to the choices. */
  showConfirmation(choice: GarageExceedChoice): void {
    if (this.disposed || this.confirming) return;
    this.confirming = true;
    this.window?.render();
    const ask = this.dependencies.confirm ?? ((title, message, options) =>
      confirmGame(title, message, "确定", "取消", { signal: options.signal,
        library: options.library as BmlLibrary | undefined }));
    void ask("变更超负荷类型", this.confirmationText(choice), { library: this.library, signal: this.question.signal })
      .catch(error => {
        console.error("超负荷类型确认窗口打开失败", error);
        return false;
      })
      .then(accepted => {
        if (this.disposed) return;
        this.confirming = false;
        if (accepted) {
          this.close(this.dependencies.resolveChoice(choice));
          return;
        }
        this.window?.render();
        this.window?.focus("cancelButton");
      });
  }

  close(selected?: number): void {
    if (this.disposed) return;
    this.disposed = true;
    this.question.abort();
    this.window?.dispose();
    this.window = undefined;
    this.onClose(selected);
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }

  dispose(): void { this.close(undefined); }
}
