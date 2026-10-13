/**
 * The lamps of 卡丁城's traffic signals (CITY-NPC.md): the Vice City map
 * has its own signal heads (horizontal three-lamp bars) over the junctions;
 * the traffic network says which approach each one faces. A disc for each
 * lamp sits just in front of the bar — red on the drivers' left, then
 * yellow, then green — and the one the junction's plan shows now is lit,
 * on the node clock, exactly when the node's cars obey it. All discs are
 * one mesh with vertex colours (one draw call).
 */
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, type Object3D,
} from "three";
import { ie as setWorldRenderRecord } from "../generated/formats.js";
import { designToWorld } from "./city-coordinates";
import { ASPECT_GREEN, ASPECT_RED, ASPECT_YELLOW, signalAspect, type TrafficNetwork } from "./city-traffic-network";

const SEGMENTS = 12;
/** Disc radius and how far in front of the bar's centre the discs sit (m). */
const LAMP_RADIUS = 0.15;
const LAMP_FRONT = 0.24;
const UPDATE_MS = 200;

const LIT = [new Color(0xff2a1a), new Color(0xffc21a), new Color(0x2aff6a)];
const DARK = [new Color(0x3a0c08), new Color(0x3a2a06), new Color(0x08301a)];

interface Lamp { junction: number; group: number; first: number }

export class CityTrafficLights {
  readonly mesh: Mesh;
  private readonly lamps: Lamp[] = [];
  private readonly colors: Float32Array;
  private readonly shown: Int8Array;
  private lastUpdate = -Infinity;

  constructor(readonly network: TrafficNetwork, readonly scene: Object3D, readonly serverNow: () => number) {
    const positions: number[] = [];
    network.junctions.forEach((junction, index) => {
      if (junction.control !== "signal" || !junction.signal) return;
      for (const lamp of junction.lamps ?? []) {
        const approach = junction.approaches[lamp.approach];
        if (!approach) continue;
        this.lamps.push({ junction: index, group: approach.group, first: positions.length / 3 });
        const h = (lamp.heading * Math.PI) / 180;
        // Facing (0 north, clockwise): x east, z south; the drivers' left is the lamp's right.
        const fx = Math.sin(h), fz = -Math.cos(h);
        const lx = -fz, lz = fx; // right of the facing = the drivers' left
        const spacing = lamp.length * 0.32;
        for (let k = 0; k < 3; k++) {
          const along = spacing * (1 - k);
          const cx = lamp.x + fx * LAMP_FRONT + lx * along, cz = lamp.z + fz * LAMP_FRONT + lz * along;
          const center = designToWorld(cx, lamp.y, cz);
          // A fan of triangles in the plane facing the drivers (its normal is the facing).
          for (let s = 0; s < SEGMENTS; s++) {
            const a0 = (s / SEGMENTS) * Math.PI * 2, a1 = ((s + 1) / SEGMENTS) * Math.PI * 2;
            const corner = (a: number) => [
              center.x + lx * Math.cos(a) * LAMP_RADIUS, center.y + Math.sin(a) * LAMP_RADIUS,
              center.z + lz * Math.cos(a) * LAMP_RADIUS,
            ];
            positions.push(center.x, center.y, center.z, ...corner(a1), ...corner(a0));
          }
        }
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    this.colors = new Float32Array(positions.length);
    geometry.setAttribute("color", new BufferAttribute(this.colors, 3));
    geometry.computeBoundingSphere();
    // Lamps glow by themselves (no lighting); both sides, the back is hidden by the bar.
    const material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true, side: DoubleSide });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = "city-traffic-lights";
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.shown = new Int8Array(this.lamps.length).fill(-1);
    // The race renderer draws only what has a release render record: a world object sorted by depth.
    setWorldRenderRecord(this.mesh, 0, true);
    scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);
  }

  /** How many lamp bars are drawn. */
  get count(): number { return this.lamps.length; }

  /** The aspect each lamp bar shows now (tests and debugging). */
  aspects(): number[] {
    return [...this.shown];
  }

  update(now: number): void {
    if (now - this.lastUpdate < UPDATE_MS) return;
    this.lastUpdate = now;
    const tick = this.serverNow();
    let changed = false;
    this.lamps.forEach((lamp, i) => {
      const plan = this.network.junctions[lamp.junction]!.signal!;
      const aspect = signalAspect(plan, lamp.group, tick);
      if (this.shown[i] === aspect) return;
      this.shown[i] = aspect;
      changed = true;
      // Lamps left to right: red, yellow, green.
      const lit = [aspect === ASPECT_RED, aspect === ASPECT_YELLOW, aspect === ASPECT_GREEN];
      for (let k = 0; k < 3; k++) {
        const color = lit[k] ? LIT[k]! : DARK[k]!;
        const start = (lamp.first + k * SEGMENTS * 3) * 3;
        for (let v = 0; v < SEGMENTS * 3; v++) {
          this.colors[start + v * 3] = color.r;
          this.colors[start + v * 3 + 1] = color.g;
          this.colors[start + v * 3 + 2] = color.b;
        }
      }
    });
    if (changed) (this.mesh.geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
