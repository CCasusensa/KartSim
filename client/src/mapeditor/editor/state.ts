/**
 * 编辑器状态：当前设计、选择、撤销/重做。所有改动经 commit() 记入历史；
 * 拖动中的连续改动用 preview()，松手时再 commit()。
 */
import { newDesign, randomId, type MapDesign, type PieceDesign, type RoadDesign } from "../design";

export type Selection =
  | { kind: "pieces"; ids: string[] }
  | { kind: "road"; id: string; point?: number }
  | undefined;

export type ChangeKind = "design" | "selection" | "meta";

const HISTORY = 60;

export class EditorState {
  design: MapDesign = newDesign();
  selection: Selection;
  dirty = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private committed = JSON.stringify(this.design);
  private readonly listeners = new Set<(kind: ChangeKind) => void>();

  on(listener: (kind: ChangeKind) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(kind: ChangeKind): void {
    for (const listener of this.listeners) listener(kind);
  }

  /** 换一个设计（新建、打开）：清空历史。 */
  load(design: MapDesign): void {
    this.design = design;
    this.selection = undefined;
    this.undoStack = [];
    this.redoStack = [];
    this.committed = JSON.stringify(design);
    this.dirty = false;
    this.emit("design");
    this.emit("selection");
  }

  /** 改动并记入历史。 */
  commit(change?: (design: MapDesign) => void): void {
    change?.(this.design);
    const next = JSON.stringify(this.design);
    if (next === this.committed) { this.emit("design"); return; }
    this.undoStack.push(this.committed);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.committed = next;
    this.design.updatedAt = Date.now();
    this.dirty = true;
    this.validateSelection();
    this.emit("design");
  }

  /** 拖动中的改动：只刷新显示，不记历史。 */
  preview(change: (design: MapDesign) => void): void {
    change(this.design);
    this.emit("design");
  }

  undo(): void { this.step(this.undoStack, this.redoStack); }
  redo(): void { this.step(this.redoStack, this.undoStack); }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  private step(from: string[], to: string[]): void {
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push(this.committed);
    this.committed = snapshot;
    this.design = JSON.parse(snapshot) as MapDesign;
    this.dirty = true;
    this.validateSelection();
    this.emit("design");
    this.emit("selection");
  }

  markSaved(): void { this.dirty = false; this.emit("meta"); }

  select(selection: Selection): void {
    this.selection = selection;
    this.emit("selection");
  }

  private validateSelection(): void {
    const selection = this.selection;
    if (selection?.kind === "pieces") {
      const ids = selection.ids.filter(id => this.design.pieces.some(piece => piece.id === id));
      this.selection = ids.length ? { kind: "pieces", ids } : undefined;
    } else if (selection?.kind === "road") {
      const road = this.road(selection.id);
      if (!road) this.selection = undefined;
      else if (selection.point !== undefined && selection.point >= road.points.length)
        this.selection = { kind: "road", id: road.id };
    }
  }

  road(id: string): RoadDesign | undefined {
    return this.design.roads.find(road => road.id === id);
  }

  piece(id: string): PieceDesign | undefined {
    return this.design.pieces.find(piece => piece.id === id);
  }

  selectedPieces(): PieceDesign[] {
    const selection = this.selection;
    if (selection?.kind !== "pieces") return [];
    return selection.ids.flatMap(id => this.piece(id) ?? []);
  }

  selectedRoad(): RoadDesign | undefined {
    return this.selection?.kind === "road" ? this.road(this.selection.id) : undefined;
  }

  newId(prefix: string): string {
    return `${prefix}${randomId(8)}`;
  }
}
