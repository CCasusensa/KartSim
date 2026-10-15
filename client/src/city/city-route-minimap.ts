import { tr } from "../i18n/locale";
/**
 * The navigation route on the race HUD minimap: a green ribbon (dark green
 * rim, light green core) and a destination pin added to the minimap's map
 * scene, under every racer marker (the minimap renders its map scene, clears
 * depth, then the markers), plus a "目的地 · 距离" label above the minimap.
 *
 * Minimap scene units are meters in the native client frame (x east, y
 * north): a three.js world point (X, Z) sits at
 * (canvasWidth / 2 + X − centerX, canvasHeight / 2 − Z − centerY) of the
 * track's ToMinimap record. The map quad is drawn transparent at render
 * order 0, so the route is transparent too and comes after it.
 */
import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LinearSRGBColorSpace, Mesh, MeshBasicMaterial,
} from "three";
import { l5, qB } from "../generated/formats.js";
import { FONT } from "../ui/bml-kit";
import { designToWorld } from "./city-coordinates";
import type { CityNavigator } from "./city-navigator";
import type { NavPoint } from "./city-nav";

export interface MinimapSource { centerX: number; centerY: number; canvasWidth: number; canvasHeight: number }

/** Design x/z → minimap scene x/y. */
export function designToMinimap(source: MinimapSource, x: number, z: number): [number, number] {
  const world = designToWorld(x, 0, z);
  return [source.canvasWidth / 2 + (world.x - source.centerX), source.canvasHeight / 2 + (-world.z - source.centerY)];
}

/** Route widths (m): the rim and the core. */
export const ROUTE_RIM_WIDTH = 13;
export const ROUTE_CORE_WIDTH = 7.5;
const JOIN_SIDES = 8;

/**
 * Triangles (x, y, z per vertex) of a constant-width ribbon along a
 * polyline: a quad per segment and a disc at every vertex, so bends and
 * the ends are round and leave no gaps.
 */
export function ribbonTriangles(points: ReadonlyArray<readonly [number, number]>, width: number, z: number): Float32Array {
  const half = width / 2, out: number[] = [];
  const disc = (x: number, y: number) => {
    for (let i = 0; i < JOIN_SIDES; i++) {
      const a = (i / JOIN_SIDES) * Math.PI * 2, b = ((i + 1) / JOIN_SIDES) * Math.PI * 2;
      out.push(x, y, z, x + Math.cos(a) * half, y + Math.sin(a) * half, z, x + Math.cos(b) * half, y + Math.sin(b) * half, z);
    }
  };
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]!;
    disc(x, y);
    if (i === 0) continue;
    const [px, py] = points[i - 1]!, dx = x - px, dy = y - py, length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const nx = (-dy / length) * half, ny = (dx / length) * half;
    out.push(px + nx, py + ny, z, px - nx, py - ny, z, x + nx, y + ny, z);
    out.push(x + nx, y + ny, z, px - nx, py - ny, z, x - nx, y - ny, z);
  }
  return new Float32Array(out);
}

/** An sRGB colour as the linear-output renderer shows it (the HUD renderer does no conversion). */
function displayColor(hex: number): Color {
  return new Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, LinearSRGBColorSpace);
}

function material(hex: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: displayColor(hex), transparent: true, opacity: 1, depthTest: false, depthWrite: false,
    side: DoubleSide, toneMapped: false });
}

export const ROUTE_RIM = 0x0b5d1e, ROUTE_CORE = 0x5cf26a;
const PIN_RIM = 0xffffff, PIN_CORE = 0x26c43c;

export interface HudMinimap {
  source: MinimapSource;
  mapScene?: { object?: Group };
  /** Its minimap.bml layout (size, align, adjust), resolved the way its render() does. */
  window?: unknown;
}

/** The minimap's stage rectangle (1600×900), as _00.render places it. */
export function minimapStageRect(minimap: HudMinimap): { x: number; y: number; width: number; height: number } | undefined {
  if (!minimap.window) return undefined;
  try {
    const { x, y, width, height } = qB(l5(minimap.window, { left: 0, top: 0, right: 1600, bottom: 900 }));
    return { x: x!, y: y!, width: width!, height: height! };
  } catch {
    return undefined;
  }
}

export class CityRouteMinimap {
  private readonly group = new Group();
  private readonly rim: Mesh;
  private readonly core: Mesh;
  private readonly pinRim: Mesh;
  private readonly pinCore: Mesh;
  private revision = -1;
  private label?: HTMLCanvasElement;

  constructor(private readonly minimap: HudMinimap, private readonly overlayRoot?: HTMLElement,
    private readonly stageCanvas?: HTMLElement) {
    this.group.name = "city-navigation-route";
    const mesh = (hex: number, order: number) => {
      const value = new Mesh(new BufferGeometry(), material(hex));
      value.renderOrder = order;
      value.frustumCulled = false;
      this.group.add(value);
      return value;
    };
    this.rim = mesh(ROUTE_RIM, 1);
    this.core = mesh(ROUTE_CORE, 2);
    this.pinRim = mesh(PIN_RIM, 3);
    this.pinCore = mesh(PIN_CORE, 4);
    this.group.visible = false;
    minimap.mapScene?.object?.add(this.group);
  }

  /** Rebuilds the meshes when the navigator's route changed; draws the label (not while covered). */
  update(navigator: CityNavigator, covered = false): void {
    if (navigator.revision !== this.revision) {
      this.revision = navigator.revision;
      const destination = navigator.destination;
      this.group.visible = !!destination;
      if (destination) {
        const points = navigator.route.map(p => designToMinimap(this.minimap.source, p.x, p.z));
        this.set(this.rim, ribbonTriangles(points, ROUTE_RIM_WIDTH, 0.3));
        this.set(this.core, ribbonTriangles(points, ROUTE_CORE_WIDTH, 0.35));
        const pin = designToMinimap(this.minimap.source, destination.x, destination.z);
        this.set(this.pinRim, ribbonTriangles([pin], 22, 0.4));
        this.set(this.pinCore, ribbonTriangles([pin], 15, 0.45));
      }
    }
    this.drawLabel(navigator, covered);
  }

  private set(mesh: Mesh, positions: Float32Array): void {
    mesh.geometry.dispose();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    mesh.geometry = geometry;
  }

  /** "目的地 · 1.2 km" right above the minimap window (stage units, 1600×900). */
  private drawLabel(navigator: CityNavigator, covered: boolean): void {
    const root = this.overlayRoot, stage = this.stageCanvas, window = minimapStageRect(this.minimap);
    if (!root || !stage || !window) return;
    if (!navigator.destination || covered) { this.label?.remove(); this.label = undefined; return; }
    if (!this.label) {
      this.label = document.createElement("canvas");
      this.label.className = "kartcity-navigation-label";
      this.label.setAttribute("aria-label", tr("导航"));
      Object.assign(this.label.style, { position: "absolute", pointerEvents: "none", zIndex: "4" });
      root.append(this.label);
    }
    const label = this.label;
    // Over the renderer canvas, whose CSS box is the 1600×900 stage.
    Object.assign(label.style, { left: `${stage.offsetLeft}px`, top: `${stage.offsetTop}px`,
      width: `${stage.offsetWidth}px`, height: `${stage.offsetHeight}px` });
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.round(stage.offsetWidth * ratio), height = Math.round(stage.offsetHeight * ratio);
    if (!width || !height) return;
    if (label.width !== width || label.height !== height) { label.width = width; label.height = height; }
    const context = label.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.setTransform(width / 1600, 0, 0, height / 900, 0, 0);
    paintNavigationLabel(context, window, navigator.statusText());
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of [this.rim, this.core, this.pinRim, this.pinCore]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this.label?.remove();
    this.label = undefined;
  }
}

/** The label box: a dark plate with a green pin and the text, right-aligned to the minimap. */
export function paintNavigationLabel(context: CanvasRenderingContext2D,
  window: { x: number; y: number; width: number; height: number }, text: string): void {
  context.font = `bold 15px ${FONT}`;
  const textWidth = context.measureText(text).width;
  const height = 28, width = Math.min(window.width + 60, textWidth + 44);
  const right = window.x + window.width, x = right - width, y = window.y - height - 6;
  context.fillStyle = "rgba(6, 18, 40, 0.78)";
  context.strokeStyle = "rgba(92, 242, 106, 0.85)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect?.(x, y, width, height, 8);
  context.fill();
  context.stroke();
  paintPin(context, x + 16, y + height / 2, 7);
  context.fillStyle = "#ffffff";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.save();
  context.beginPath();
  context.rect(x + 28, y, width - 34, height);
  context.clip();
  context.fillText(text, x + 30, y + height / 2 + 1);
  context.restore();
}

/** A map pin: white-rimmed green drop pointing at (x, y + size). */
export function paintPin(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.beginPath();
  context.arc(x, y - size * 0.35, size * 0.75, Math.PI * 0.85, Math.PI * 0.15);
  context.lineTo(x, y + size);
  context.closePath();
  context.fillStyle = "#26c43c";
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(1.5, size * 0.25);
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(x, y - size * 0.35, size * 0.28, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
}

/** Route points in minimap scene units (tests). */
export function routeOnMinimap(source: MinimapSource, route: readonly NavPoint[]): Array<[number, number]> {
  return route.map(p => designToMinimap(source, p.x, p.z));
}
