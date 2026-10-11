// Constructors for decoder-shaped track.1s objects (the shapes formats.js's
// y9 produces), so the generated city goes through the normal track loader.
import { bounds } from "./geometry.mjs";

export const IDENTITY_BASIS = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function xml(name, attributes = {}, children = [], text = "") {
  return {
    name, text,
    attributes: Object.entries(attributes).map(([key, value]) => ({ name: key, value: String(value) })),
    children,
  };
}

/** A node in the scene graph (Relement or a mesh class). */
export function node(className, name, fields = {}) {
  return {
    kind: "node", className, name,
    children: [],
    transform: IDENTITY_BASIS(), position: [0, 0, 0], scale: [1, 1, 1],
    bounds0: { min: [0, 0, 0], max: [0, 0, 0] },
    serializedBoundsOverride: 0, cullingTraversalMode: 0,
    bounds1: { min: [0, 0, 0], max: [0, 0, 0] },
    rawScalar: 0, nodeEnabled: 1,
    slots: Array.from({ length: 11 }), slotOccurrences: Array.from({ length: 11 }),
    ...fields,
  };
}

export function group(name, children = [], fields = {}) {
  const result = node("Relement", name, fields);
  result.children = children;
  return result;
}

/** Texture stage property; `road` (an attribute map) marks a collision road mesh. */
export function texture(name, { road, textureOp = 1, addressU = 1, addressV = 1 } = {}) {
  const property = road ? xml("property", {}, [xml("road", road)]) : undefined;
  return {
    kind: "texture", textureOp, name,
    addressU, addressV, minFilter: 2, magFilter: 3, mipFilter: 2, maxAnisotropy: 1,
    uvControllers: Array.from({ length: 5 }), uvControllerOccurrences: Array.from({ length: 5 }),
    scalar: 1, alphaController: undefined, alphaControllerOccurrence: undefined,
    property, propertyOccurrence: property ? { encoding: "new", value: property } : undefined,
  };
}

export function alpha({ blend = false, test = false, ref = 0 } = {}) {
  return {
    kind: "alpha", blendEnable: blend ? 1 : 0, srcBlend: 5, dstBlend: 6,
    alphaTestEnable: test ? 1 : 0, compare: 5, alphaRef: ref,
  };
}

export function backface(cull) { return { kind: "backface", cull }; }

export const SLOT = { alpha: 3, backface: 4, texture: 7 };

/**
 * A ReTriList mesh node from a MeshBuilder. Positions are in the node's
 * local space (we use identity transforms, so client coordinates).
 */
export function meshNode(name, mesh, textureSlot, { alphaSlot, backfaceSlot, sortDepthBias = 0, colors = false } = {}) {
  const result = node("ReTriList", name, { sortDepthBias });
  const vertexCount = mesh.positions.length;
  if (vertexCount > 65535 || mesh.indices.length > 65535)
    throw new Error(`${name}: 网格超过 65535 顶点/索引（${vertexCount}/${mesh.indices.length}）。`);
  const box = bounds(mesh.positions);
  result.bounds0 = { min: box.min, max: box.max };
  result.vertexData = {
    vertexCount,
    positions: mesh.positions.map(p => [p[0], p[1], p[2]]),
    normals: mesh.normals.map(n => [n[0], n[1], n[2]]),
    diffuseColors: colors ? mesh.colors.slice() : undefined,
    uvSetsPerVertex: 1,
    uvs: mesh.uvs.map(uv => [[uv[0], uv[1]]]),
    property: undefined, propertyOccurrence: undefined,
    indices: mesh.indices.slice(),
  };
  result.vertexDataOccurrence = { encoding: "new", value: result.vertexData };
  result.slots[SLOT.texture] = textureSlot;
  if (alphaSlot) result.slots[SLOT.alpha] = alphaSlot;
  if (backfaceSlot) result.slots[SLOT.backface] = backfaceSlot;
  for (let i = 0; i < 11; i++) result.slotOccurrences[i] = result.slots[i] ? { encoding: "new", value: result.slots[i] } : undefined;
  return result;
}

export function trackObject(name, property) {
  return { kind: "TrackObject", name, property };
}

export function toRoad(name, records, cyclic = true) {
  return { kind: "ToRoad", name, property: undefined, cyclic, records };
}

export function toMinimap({ centerX, centerY, scale, canvasWidth = 256, canvasHeight = 256, padding = 4 }) {
  return { kind: "ToMinimap", name: "", property: undefined, centerX, centerY, scale, canvasWidth, canvasHeight, padding };
}

export function toDummy(name, position, property) {
  return {
    kind: "ToDummy", name, property,
    transform: { basis: IDENTITY_BASIS(), position, scale: [1, 1, 1] },
    instanceOrdinal: undefined,
  };
}

/** The whole file: a TrackContainer with one scene and its track objects. */
export function trackContainer(name, scene, trackObjects) {
  return {
    kind: "track", name, scene,
    sceneOccurrence: { encoding: "new", value: scene },
    trackObjects,
    trackObjectOccurrences: trackObjects.map(value => ({ encoding: "new", value })),
  };
}

/**
 * Rotation about the client Z (up) axis by `degrees` as the node basis. The
 * loader treats `transform[i]` as matrix rows, so this is the usual
 * row-major rotation matrix.
 */
export function yawBasis(degrees) {
  const r = (degrees * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
