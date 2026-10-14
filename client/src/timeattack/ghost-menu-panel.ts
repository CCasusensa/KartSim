import {
  deleteGhostFromMenu, exportGhostFromMenu, importSelectedGhostFile,
  isCurrentGhostImport, switchToImportedGhostTrack,
  type GhostImportSelection, type GhostMenuHost,
  type GhostMenuImportDependencies, type GhostMenuOptions,
} from "./ghost-menu-import";
import { registerTouchMenuSection, type TouchMenuEntry, type TouchMenuSection } from "../input/touch-driving-controls";

export type GhostSamplingMode = "native" | "native-smooth" | "c1" | "c2";

export interface GhostMenuPanelOptions extends GhostMenuOptions {
  root: HTMLElement;
  samplingMode(): GhostSamplingMode;
  onSamplingModeChange(mode: GhostSamplingMode): void;
  resetNickname(): void;
}

export interface GhostMenuPanelDependencies {
  samplingLabels: Record<GhostSamplingMode, string>;
  nextSamplingMode(mode: GhostSamplingMode): GhostSamplingMode;
  saveSamplingMode(mode: GhostSamplingMode): void;
  import: GhostMenuImportDependencies;
}

export const GHOST_MENU_HINT =
  "S0 / L2 等同字节档位，按“速度频道设置”的现代／复古版本导入；请先选对应版本。";

/**
 * The Ghost import/export tools: a 影子记录 group of release TextButtons
 * in the SIM menu (registered on the hidden element it adds to the menu's
 * slot, which also holds the .ksv file input).
 */
export class GhostMenuPanel implements GhostMenuHost, TouchMenuSection {
  readonly panel: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly title = "影子记录";
  readonly hint = GHOST_MENU_HINT;
  disposed = false;
  importRevision = 0;
  pendingTrackSwitch?: Promise<unknown>;

  constructor(
    readonly options: GhostMenuPanelOptions,
    readonly dependencies: GhostMenuPanelDependencies,
  ) {
    this.panel = document.createElement("div");
    this.panel.className = "touch-ghost-panel";
    this.panel.hidden = true;
    this.input = document.createElement("input");
    this.input.type = "file";
    this.input.accept = ".ksv";
    this.input.hidden = true;
    this.input.addEventListener("change", this.onFileSelected);
    this.panel.append(this.input);
    registerTouchMenuSection(this.panel, this);
    options.root.append(this.panel);
  }

  static attach(options: GhostMenuPanelOptions,
    dependencies: GhostMenuPanelDependencies): GhostMenuPanel {
    return new GhostMenuPanel(options, dependencies);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.removeEventListener("change", this.onFileSelected);
    this.panel.remove();
  }

  /** The SIM menu buttons, in the release panel's order. */
  menuEntries(): TouchMenuEntry[] {
    return [
      { name: "ghost-import", text: "导入影子(.ksv)", action: this.openPicker },
      { name: "ghost-export", text: "导出 KSV", action: this.onExportClick },
      { name: "ghost-delete", text: "删除影子", action: this.onDeleteClick },
      { name: "ghost-sampling", text: this.samplingModeLabel(), action: this.onSamplingModeToggle },
      { name: "ghost-reset-nickname", text: "重置车手名", action: () => this.options.resetNickname() },
    ];
  }

  /** The mode in use (the release label was refreshed before the mode changed, one step behind). */
  samplingModeLabel(): string {
    return `幽灵插值：${this.dependencies.samplingLabels[this.options.samplingMode()]}`;
  }

  onSamplingModeToggle = (): void => {
    const next = this.dependencies.nextSamplingMode(this.options.samplingMode());
    this.dependencies.saveSamplingMode(next);
    this.options.onSamplingModeChange(next);
  };

  openPicker = (): void => {
    this.input.value = "";
    this.input.click();
  };
  onFileSelected = (): void => { void this.importSelectedFile(); };
  onDeleteClick = (): void => { void this.deleteGhost(); };
  onExportClick = (): void => { void this.exportGhost(); };

  deleteGhost(): Promise<void> { return deleteGhostFromMenu(this); }
  exportGhost(): Promise<void> { return exportGhostFromMenu(this); }
  importSelectedFile(): Promise<void> {
    return importSelectedGhostFile(this, this.dependencies.import);
  }
  isCurrentImport(revision: number): boolean {
    return isCurrentGhostImport(this, revision);
  }
  switchToImportedTrack(selection: GhostImportSelection, zCeiling: number,
    frameCount: number, revision: number): Promise<void> {
    return switchToImportedGhostTrack(this, selection, zCeiling, frameCount,
      revision, this.dependencies.import);
  }
}
