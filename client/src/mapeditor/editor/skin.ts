/**
 * 编辑器的游戏外观：从发行版的 gui_/monocoque/frame.bml 读取框体（标题栏、
 * 左右边、底边在贴图上的位置），用游戏自己的 C9 画成一张小样板，再作为
 * CSS 九宫格（border-image）贴到面板、按钮、输入框上；字体用游戏的思源黑体。
 */
import { C9, Ft, p2 } from "../../generated/formats.js";
import { F9, U1 } from "../../generated/library.js";

interface FrameRect { x: number; y: number; width: number; height: number }
interface Frame {
  texture: string;
  caption: FrameRect; left: FrameRect; right: FrameRect; client: FrameRect; bottom: FrameRect;
  captionLeftMargin: number; captionRightMargin: number;
  bottomLeftMargin: number; bottomRightMargin: number;
  clientType: string;
}

interface SkinLibrary {
  canonicalCandidates(path: string): Array<{ bytes(): Promise<Uint8Array> }>;
}

export const EDITOR_FONT = "KartEditorFont";

/** 框体名 → CSS 选择器（按状态：常态、悬停、按下、禁用）。 */
const SKINS: Array<{ frame: string; selectors: string[] }> = [
  { frame: "CaptionDialog", selectors: [".k-dialog"] },
  { frame: "CaptionInnerWindow", selectors: [".k-inner"] },
  { frame: "BlackCaptionWindow", selectors: [".k-black"] },
  { frame: "TextButton", selectors: [".k-button", ".k-button:hover:not(:disabled)", ".k-button:active:not(:disabled), .k-button.k-on", ".k-button:disabled"] },
  { frame: "BlueStaticButton", selectors: [".k-blue", ".k-blue:hover:not(:disabled)", ".k-blue:active:not(:disabled), .k-blue.k-on", ".k-blue:disabled"] },
  { frame: "DefaultStaticButton", selectors: [".k-row", ".k-row:hover"] },
  { frame: "DefaultStaticButton_SelectedBlue", selectors: [".k-row.k-selected"] },
  { frame: "DefaultEdit", selectors: [".k-edit"] },
  { frame: "ComboBox", selectors: [".k-combo"] },
  { frame: "Tab", selectors: [".k-tab", ".k-tab:hover", ".k-tab.k-on"] },
  { frame: "DefaultTooltip", selectors: [".k-tip"] },
  { frame: "DefaultVerticalScrollArea", selectors: ["::-webkit-scrollbar-track"] },
  { frame: "DefaultVerticalScrollButton", selectors: ["::-webkit-scrollbar-thumb", "::-webkit-scrollbar-thumb:hover"] },
];

async function decode(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const image = await p2(bytes) as { width: number; height: number; pixels: ArrayLike<number> };
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  return canvas;
}

/** 用 C9 画一张中间可拉伸 8 像素的样板，返回 CSS 九宫格。 */
function frameCss(frame: Frame, image: CanvasImageSource): string | undefined {
  const top = frame.caption.height, bottom = frame.bottom.height;
  const left = Math.max(frame.left.width, frame.captionLeftMargin, frame.bottomLeftMargin);
  const right = Math.max(frame.right.width, frame.captionRightMargin, frame.bottomRightMargin);
  const middle = 8;
  const width = left + middle + right, height = top + middle + bottom;
  if (width <= middle || height <= middle) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  C9(context, frame, image, { x: 0, y: 0, width, height });
  const url = canvas.toDataURL("image/png");
  return `border-style: solid; border-width: ${top}px ${right}px ${bottom}px ${left}px; ` +
    `border-image: url(${url}) ${top} ${right} ${bottom} ${left} fill / ${top}px ${right}px ${bottom}px ${left}px stretch;`;
}

/** 装上游戏外观；失败时（缺资源）保留编辑器的纯 CSS 外观。 */
export async function installEditorSkin(library: SkinLibrary): Promise<void> {
  const style = document.createElement("style");
  style.dataset.editorSkin = "";
  const rules: string[] = [];
  // 字体在 18 MB 的 gui_font.rho 里，按需分段读取较慢：后台载入，到了再换上
  void (async () => {
    try {
      const font = await (U1(library, ["gui_/font"], "SourceHanSansCN-Bold", ".otf") as { bytes(): Promise<Uint8Array> }).bytes();
      const face = new FontFace(EDITOR_FONT, font.slice().buffer);
      await face.load();
      document.fonts.add(face);
    } catch (error) {
      console.warn("游戏字体未载入", error);
    }
  })();
  try {
    const tree = await F9(library, "gui_/monocoque", "frame") as { children: Array<{ name: string; children: unknown[] }> };
    const frames = new Map<string, Frame[]>();
    for (const entry of tree.children) {
      try { frames.set(entry.name, entry.children.map(state => Ft(state) as Frame)); } catch { /* 不认识的 clientType */ }
    }
    const images = new Map<string, Promise<HTMLCanvasElement | undefined>>();
    const image = (name: string) => {
      let pending = images.get(name);
      if (!pending) {
        const file = library.canonicalCandidates(`gui_/monocoque/${name}.png`)[0];
        pending = file ? file.bytes().then(decode).catch(() => undefined) : Promise.resolve(undefined);
        images.set(name, pending);
      }
      return pending;
    };
    for (const { frame, selectors } of SKINS) {
      const states = frames.get(frame);
      if (!states?.length) continue;
      for (let state = 0; state < selectors.length; state++) {
        const definition = states[Math.min(state, states.length - 1)]!;
        const texture = await image(definition.texture);
        const css = texture && frameCss(definition, texture);
        if (css) rules.push(`${selectors[state]} { ${css} }`);
      }
    }
  } catch (error) {
    console.warn("游戏框体未载入", error);
  }
  style.textContent = rules.join("\n");
  document.head.append(style);
  document.documentElement.classList.add("k-skinned");
}
