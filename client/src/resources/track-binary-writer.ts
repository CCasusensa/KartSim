/**
 * Encoder for the game's track.1s object graphs: the inverse of the decoders
 * the generated `y9` parser uses (src/generated/formats.js) and of
 * TrackBinaryCursor / TrackObjectRegistry in track-binary-reader.ts.
 *
 * `encodeTrackModel(root)` accepts exactly the shape those decoders produce
 * (a `kind: "track"` TrackContainer or a `kind: "node"` Relement scene) and
 * writes a stream that parses back to a deep-equal graph. Object ids and
 * field ids are assigned sequentially in stream order of first appearance;
 * a JS object met a second time (by identity) becomes a reference record,
 * which is how the original files number their records, so re-encoding a
 * parsed file reproduces it byte for byte. The parsed `*Occurrence` metadata
 * is ignored, except that a texture name field (a string, so it has no
 * identity) is shared through its `nameOccurrence.id` when present.
 */

const NEW_OBJECT = 18346;
const OBJECT_REFERENCE = 18363;
const NEW_FIELD = 10154;
const FIELD_REFERENCE = 10171;

/** Class stamps of every record type the track decoders register (`a9`). */
export const TRACK_CLASS_STAMPS = {
  TrackContainer: 687408536,
  Relement: 235340604,
  ReTriStrip: 352060408,
  ReTriList: 282329986,
  ReToonRigid: 422184006,
  ReBillboard: 413074498,
  ReCamera: 217187072,
  TrackObject: 424870988,
  ToRoad: 131990089,
  TexProperty: 444138646,
  AlphaProperty: 593036619,
  BackFaceProperty: 842597957,
  MtlProperty: 441844882,
  ZBufProperty: 501810396,
  WireProperty: 525010172,
  ToonProperty: 530318597,
  PrsController: 575341866,
  VisController: 621610343,
  FloatController: 805242411,
  IntController: 615187808,
  ColorController: 812058164,
  MorphController: 820577851,
  FogProperty: 430572673,
  ToDummy: 178782927,
  ToBlackPlane: 486016144,
  ToMesh: 131334736,
  ToEventMesh: 425395282,
  ToMinimap: 289407886,
  ToItemCube: 347472849,
  ToLucci: 177078963,
  ToMovableObject: 778110432,
  PathController: 706020803,
  TontrollerGroup: 833422914,
} as const;

/** Relement slot index of each property / controller kind (`Tq` + prs). */
export const NODE_SLOT = {
  prs: 1,
  alpha: 3,
  backface: 4,
  "fog-property": 5,
  material: 6,
  texture: 7,
  toon: 8,
  wire: 9,
  zbuffer: 10,
} as const;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type TrackNodeClassName =
  "Relement" | "ReTriList" | "ReTriStrip" | "ReToonRigid" | "ReBillboard" | "ReCamera";

export interface TrackXmlAttribute { name: string; value: string }

export interface TrackXmlNode {
  name: string;
  text: string;
  attributes: TrackXmlAttribute[];
  children: TrackXmlNode[];
}

export interface TexProperty {
  kind: "texture";
  textureOp: number;
  /** Texture base name without extension, e.g. "lamp00". */
  name?: string;
  nameOccurrence?: { id: number } | undefined;
  addressU: number;
  addressV: number;
  minFilter: number;
  magFilter: number;
  mipFilter: number;
  maxAnisotropy: number;
  uvControllers: (TrackProperty | undefined)[];
  scalar: number;
  alphaController?: TrackProperty;
  property?: TrackXmlNode;
}

export interface AlphaProperty {
  kind: "alpha";
  blendEnable: number;
  srcBlend: number;
  dstBlend: number;
  alphaTestEnable: number;
  compare: number;
  alphaRef: number;
}

export interface BackFaceProperty { kind: "backface"; cull: number }
export interface ZBufProperty { kind: "zbuffer"; zFunc: number; zWrite: number }

/** Any slot object: texture / alpha / backface / material / zbuffer / wire / toon / fog / controllers. */
export type TrackProperty = { kind: string; [field: string]: unknown };

export interface TrackVertexData {
  vertexCount: number;
  positions?: Vec3[];
  normals?: Vec3[];
  diffuseColors?: number[];
  uvSetsPerVertex: number;
  /** uvs[vertex][set] */
  uvs: Vec2[][];
  property?: TrackProperty;
  indices: number[];
}

export interface TrackBounds { min: Vec3; max: Vec3 }

export interface TrackNode {
  kind: "node";
  className: TrackNodeClassName;
  name: string;
  children: TrackNode[];
  transform: [Vec3, Vec3, Vec3];
  position: Vec3;
  scale: Vec3;
  bounds0: TrackBounds;
  serializedBoundsOverride: number;
  cullingTraversalMode: number;
  bounds1: TrackBounds;
  rawScalar: number;
  nodeEnabled: number;
  slots: (TrackProperty | undefined)[];
  additionalProperty?: TrackXmlNode;
  /** ReTriList / ReTriStrip / ReToonRigid */
  sortDepthBias?: number;
  /** ReTriList / ReTriStrip */
  vertexData?: TrackVertexData;
  /** ReToonRigid */
  rigidGeometry?: unknown;
  /** ReBillboard */
  orientationMode?: number;
  /** ReCamera */
  camera?: unknown;
  /** Parse metadata; ignored by the encoder. */
  slotOccurrences?: unknown[];
  childOccurrences?: unknown[];
  vertexDataOccurrence?: unknown;
  rigidGeometryOccurrence?: unknown;
  additionalPropertyOccurrence?: unknown;
}

export interface TrackObjectRecord { kind: string; name: string; [field: string]: unknown }

export interface TrackContainer {
  kind: "track";
  name: string;
  scene: TrackNode;
  trackObjects: TrackObjectRecord[];
  [field: string]: unknown;
}

type Rec = Record<string, any>;

function fail(message: string): never {
  throw new Error(`track.1s 编码失败：${message}`);
}

function checkInt(value: unknown, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max)
    fail(`${label} 必须是 0..${max} 的整数，实际为 ${String(value)}。`);
  return value;
}

// NaN is allowed: original files store NaN components in some transforms.
function checkNumber(value: unknown, label: string): number {
  if (typeof value !== "number") fail(`${label} 必须是数字，实际为 ${String(value)}。`);
  return value;
}

function checkArray(value: unknown, label: string): any[] {
  if (!Array.isArray(value)) fail(`${label} 必须是数组。`);
  return value;
}

function checkObject(value: unknown, label: string): Rec {
  if (!value || typeof value !== "object") fail(`${label} 必须是对象。`);
  return value as Rec;
}

/** Growable little-endian writer mirroring TrackBinaryCursor. */
export class TrackBinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  position = 0;

  constructor(initialCapacity = 1 << 16) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensure(length: number): void {
    if (this.position + length <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.position + length) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.position));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  uint8(value: number): void {
    this.ensure(1);
    this.buffer[this.position++] = checkInt(value, 255, "uint8");
  }

  uint16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this.position, checkInt(value, 65535, "uint16"), true);
    this.position += 2;
  }

  int16(value: number): void {
    if (typeof value !== "number" || !Number.isInteger(value) || value < -32768 || value > 32767)
      fail(`int16 超出范围：${String(value)}。`);
    this.ensure(2);
    this.view.setInt16(this.position, value, true);
    this.position += 2;
  }

  uint32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.position, checkInt(value, 0xffffffff, "uint32"), true);
    this.position += 4;
  }

  float32(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this.position, checkNumber(value, "float32"), true);
    this.position += 4;
  }

  vec2(value: ArrayLike<number>): void {
    if (value.length !== 2) fail("vec2 需要 2 个分量。");
    this.float32(value[0]!);
    this.float32(value[1]!);
  }

  vec3(value: ArrayLike<number>): void {
    if (value.length !== 3) fail("vec3 需要 3 个分量。");
    this.float32(value[0]!);
    this.float32(value[1]!);
    this.float32(value[2]!);
  }

  /** uint32 code-unit count followed by UTF-16LE code units. */
  string(value: string): void {
    if (typeof value !== "string") fail(`字符串字段实际为 ${String(value)}。`);
    this.uint32(value.length);
    this.ensure(value.length * 2);
    for (let index = 0; index < value.length; index++) {
      this.view.setUint16(this.position, value.charCodeAt(index), true);
      this.position += 2;
    }
  }

  bytes(value: Uint8Array | ArrayLike<number>): void {
    this.ensure(value.length);
    this.buffer.set(value as ArrayLike<number>, this.position);
    this.position += value.length;
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.position);
  }
}

const NODE_STAMPS: Record<string, number> = {
  Relement: TRACK_CLASS_STAMPS.Relement,
  ReTriList: TRACK_CLASS_STAMPS.ReTriList,
  ReTriStrip: TRACK_CLASS_STAMPS.ReTriStrip,
  ReToonRigid: TRACK_CLASS_STAMPS.ReToonRigid,
  ReBillboard: TRACK_CLASS_STAMPS.ReBillboard,
  ReCamera: TRACK_CLASS_STAMPS.ReCamera,
};

const KIND_STAMPS: Record<string, number> = {
  track: TRACK_CLASS_STAMPS.TrackContainer,
  TrackObject: TRACK_CLASS_STAMPS.TrackObject,
  ToRoad: TRACK_CLASS_STAMPS.ToRoad,
  ToDummy: TRACK_CLASS_STAMPS.ToDummy,
  ToBlackPlane: TRACK_CLASS_STAMPS.ToBlackPlane,
  ToMesh: TRACK_CLASS_STAMPS.ToMesh,
  ToEventMesh: TRACK_CLASS_STAMPS.ToEventMesh,
  ToMinimap: TRACK_CLASS_STAMPS.ToMinimap,
  ToItemCube: TRACK_CLASS_STAMPS.ToItemCube,
  ToLucci: TRACK_CLASS_STAMPS.ToLucci,
  ToMovableObject: TRACK_CLASS_STAMPS.ToMovableObject,
  texture: TRACK_CLASS_STAMPS.TexProperty,
  alpha: TRACK_CLASS_STAMPS.AlphaProperty,
  backface: TRACK_CLASS_STAMPS.BackFaceProperty,
  material: TRACK_CLASS_STAMPS.MtlProperty,
  zbuffer: TRACK_CLASS_STAMPS.ZBufProperty,
  wire: TRACK_CLASS_STAMPS.WireProperty,
  toon: TRACK_CLASS_STAMPS.ToonProperty,
  "fog-property": TRACK_CLASS_STAMPS.FogProperty,
  prs: TRACK_CLASS_STAMPS.PrsController,
  visibility: TRACK_CLASS_STAMPS.VisController,
  "float-controller": TRACK_CLASS_STAMPS.FloatController,
  "int-controller": TRACK_CLASS_STAMPS.IntController,
  "color-controller": TRACK_CLASS_STAMPS.ColorController,
  "morph-controller": TRACK_CLASS_STAMPS.MorphController,
  "path-controller": TRACK_CLASS_STAMPS.PathController,
  "tontroller-group": TRACK_CLASS_STAMPS.TontrollerGroup,
};

const VEC3_KEY_SIZES: Record<number, number> = { 0: 40, 1: 16, 2: 28, 3: 16 };
const ROTATION_KEY_SIZES: Record<number, number> = { 0: 20, 1: 20, 2: 32, 3: 20 };
const SCALAR_KEY_SIZES: Record<number, number> = { 0: 16, 1: 8, 2: 20, 3: 8 };

/** Records written by the kind/className dispatch in `object()`. */
class TrackModelEncoder {
  readonly out = new TrackBinaryWriter();
  private readonly objectIds = new Map<object, number>();
  private readonly fieldIds = new Map<unknown, number>();

  object(value: unknown): void {
    const record = checkObject(value, "KartObject");
    const known = this.objectIds.get(record);
    if (known !== undefined) {
      this.out.uint16(OBJECT_REFERENCE);
      this.out.uint16(known);
      return;
    }
    const stamp = record.kind === "node" ? NODE_STAMPS[String(record.className)] :
      KIND_STAMPS[String(record.kind)];
    if (stamp === undefined)
      fail(`不支持的对象 kind=${String(record.kind)} className=${String(record.className)}。`);
    const id = this.objectIds.size;
    if (id > 65535) fail("对象数量超过 65536。");
    this.objectIds.set(record, id);
    this.out.uint16(NEW_OBJECT);
    this.out.uint32(stamp);
    this.out.uint16(id);
    this.body(record);
  }

  /** u8 presence flag followed by an object record (`vo`). */
  optionalObject(value: unknown): void {
    if (value === undefined || value === null) { this.out.uint8(0); return; }
    this.out.uint8(1);
    this.object(value);
  }

  field(key: unknown, encode: () => void): void {
    const known = this.fieldIds.get(key);
    if (known !== undefined) {
      this.out.uint16(FIELD_REFERENCE);
      this.out.uint16(known);
      return;
    }
    const id = this.fieldIds.size;
    if (id > 65535) fail("字段数量超过 65536。");
    this.fieldIds.set(key, id);
    this.out.uint16(NEW_FIELD);
    this.out.uint16(id);
    encode();
  }

  /** u8 presence flag followed by a field record. */
  optionalField(value: unknown, encode: (value: Rec) => void): void {
    if (value === undefined || value === null) { this.out.uint8(0); return; }
    this.out.uint8(1);
    this.field(value, () => encode(checkObject(value, "字段")));
  }

  private body(record: Rec): void {
    if (record.kind === "node") { this.node(record); return; }
    switch (record.kind) {
      case "track": return this.trackContainer(record);
      case "TrackObject": return this.trackObjectHeader(record);
      case "ToDummy": return this.dummy(record, false);
      case "ToItemCube":
      case "ToLucci": return this.dummy(record, true);
      case "ToBlackPlane": return this.blackPlane(record);
      case "ToMinimap": return this.minimap(record);
      case "ToMesh": return this.mesh(record);
      case "ToEventMesh": this.mesh(record); this.out.string(record.eventName); return;
      case "ToMovableObject": return this.movableObject(record);
      case "ToRoad": return this.road(record);
      case "texture": return this.texture(record);
      case "alpha":
        this.out.uint8(record.blendEnable);
        this.out.uint32(record.srcBlend);
        this.out.uint32(record.dstBlend);
        this.out.uint8(record.alphaTestEnable);
        this.out.uint32(record.compare);
        this.out.uint8(record.alphaRef);
        return;
      case "backface": this.out.uint32(record.cull); return;
      case "material": return this.material(record);
      case "zbuffer": this.out.uint32(record.zFunc); this.out.uint8(record.zWrite); return;
      case "wire": this.out.uint8(record.enabled); return;
      case "toon": {
        const flags = checkArray(record.flags, "toon.flags");
        const words = checkArray(record.words, "toon.words");
        if (flags.length !== 2 || words.length !== 9) fail("toon 属性需要 2 个 flag 和 9 个 word。");
        for (const flag of flags) this.out.uint8(flag);
        for (const word of words) this.out.uint32(word);
        return;
      }
      case "fog-property":
        this.out.uint32(record.selector);
        this.out.uint32(record.mode);
        this.out.uint32(record.color);
        this.out.float32(record.start);
        this.out.float32(record.end);
        this.out.float32(record.density);
        return;
      case "prs": return this.prs(record);
      case "visibility":
        this.controllerBase(record.base);
        this.field(record.keys, () => this.fixedKeys(record.keys, 3, 5, "可见性"));
        return;
      case "float-controller":
        this.controllerBase(record.base);
        this.field(record.keys, () => this.scalarKeys(record.keys, "浮点"));
        return;
      case "int-controller":
        this.controllerBase(record.base);
        this.field(record.keys, () => this.fixedKeys(record.keys, 3, 8, "整数"));
        return;
      case "color-controller":
        this.controllerBase(record.base);
        this.field(record.keys, () => this.scalarKeys(record.keys, "颜色"));
        return;
      case "morph-controller": return this.morph(record);
      case "path-controller": return this.path(record);
      case "tontroller-group": this.out.string(record.value); return;
      default: fail(`不支持的对象 kind=${String(record.kind)}。`);
    }
  }

  private trackContainer(record: Rec): void {
    this.out.string(record.name);
    this.object(record.scene);
    const objects = checkArray(record.trackObjects, "trackObjects");
    this.out.uint32(objects.length);
    for (const item of objects) this.object(item);
  }

  private node(record: Rec): void {
    const className = String(record.className);
    this.out.string(record.name);
    const children = checkArray(record.children, `${className}.children`);
    this.out.uint32(children.length);
    for (const child of children) this.object(child);
    const transform = checkArray(record.transform, "transform");
    if (transform.length !== 3) fail("transform 需要 3 个 vec3。");
    for (const row of transform) this.out.vec3(row);
    this.out.vec3(record.position);
    this.out.vec3(record.scale);
    this.bounds(record.bounds0, "bounds0");
    this.out.uint8(record.serializedBoundsOverride);
    this.out.uint32(record.cullingTraversalMode);
    this.bounds(record.bounds1, "bounds1");
    this.out.float32(record.rawScalar);
    this.out.uint8(record.nodeEnabled);
    const slots = record.slots === undefined ? [] : checkArray(record.slots, "slots");
    if (slots.length > 11) fail("slots 最多 11 项。");
    for (let index = 0; index < 11; index++) this.optionalObject(slots[index]);
    this.optionalField(record.additionalProperty, node => this.xml(node));
    switch (className) {
      case "Relement": return;
      case "ReTriList":
      case "ReTriStrip": {
        const vertexData = checkObject(record.vertexData, `${className}.vertexData`);
        this.out.float32(record.sortDepthBias);
        this.field(vertexData, () => this.vertexData(vertexData));
        return;
      }
      case "ReToonRigid": {
        const geometry = checkObject(record.rigidGeometry, "ReToonRigid.rigidGeometry");
        this.out.float32(record.sortDepthBias);
        this.field(geometry, () => this.rigidGeometry(geometry));
        return;
      }
      case "ReBillboard": this.out.uint32(record.orientationMode); return;
      case "ReCamera": {
        const camera = checkObject(record.camera, "camera");
        this.out.uint8(camera.projectionMode);
        this.out.float32(camera.fieldOfViewDegrees);
        this.optionalObject(camera.fieldOfViewController);
        this.out.float32(camera.nearClip);
        this.optionalObject(camera.nearClipController);
        this.out.float32(camera.farClip);
        this.optionalObject(camera.farClipController);
        return;
      }
      default: fail(`不支持的节点类名 ${className}。`);
    }
  }

  private bounds(value: unknown, label: string): void {
    const bounds = checkObject(value, label);
    this.out.vec3(bounds.min);
    this.out.vec3(bounds.max);
  }

  private vec3List(list: unknown, label: string, count?: number): void {
    const items = checkArray(list, label);
    if (count !== undefined && items.length !== count)
      fail(`${label} 需要 ${count} 项，实际 ${items.length} 项。`);
    for (const item of items) this.out.vec3(item);
  }

  private vertexData(value: Rec): void {
    const count = checkInt(value.vertexCount, 65535, "vertexCount");
    this.out.uint16(count);
    const optionalList = (list: unknown, label: string, write: (item: any) => void) => {
      if (list === undefined || list === null) { this.out.uint8(0); return; }
      const items = checkArray(list, label);
      if (items.length !== count) fail(`${label} 需要 ${count} 项，实际 ${items.length} 项。`);
      this.out.uint8(1);
      for (const item of items) write(item);
    };
    optionalList(value.positions, "positions", item => this.out.vec3(item));
    optionalList(value.normals, "normals", item => this.out.vec3(item));
    optionalList(value.diffuseColors, "diffuseColors", item => this.out.uint32(item));
    const sets = checkInt(value.uvSetsPerVertex, 16, "uvSetsPerVertex");
    this.out.uint16(sets);
    const uvs = checkArray(value.uvs, "uvs");
    if (uvs.length !== count) fail(`uvs 需要 ${count} 项，实际 ${uvs.length} 项。`);
    for (const vertex of uvs) {
      const vertexSets = checkArray(vertex, "uvs[vertex]");
      if (vertexSets.length !== sets) fail(`每个顶点需要 ${sets} 组 UV。`);
      for (const uv of vertexSets) this.out.vec2(uv);
    }
    this.optionalObject(value.property);
    const indices = checkArray(value.indices, "indices");
    this.out.uint16(indices.length);
    for (const index of indices) this.out.uint16(index);
  }

  private rigidGeometry(value: Rec): void {
    const positions = checkArray(value.positions, "Toon positions");
    this.out.uint32(positions.length);
    for (const item of positions) this.out.vec3(item);
    const normals = checkArray(value.normals, "Toon normals");
    this.out.uint32(normals.length);
    for (const item of normals) this.out.vec3(item);
    const texcoords = checkArray(value.texcoords, "Toon texcoords");
    this.out.uint32(texcoords.length);
    for (const item of texcoords) {
      this.out.uint16(item.rawWord);
      this.out.uint16(item.normalIndex);
      this.out.float32(item.u);
      this.out.float32(item.v);
    }
    const faces = checkArray(value.faces, "Toon faces");
    this.out.uint32(faces.length);
    for (const face of faces) {
      for (const list of [face.texcoordIndices, face.adjacentFaceIndices, face.positionIndices]) {
        const items = checkArray(list, "Toon face indices");
        if (items.length !== 3) fail("Toon 面索引需要 3 项。");
        for (const item of items) this.out.uint16(item);
      }
      this.out.uint8(face.winding);
      this.out.uint8(face.outlineOpenEdge);
    }
  }

  private trackObjectHeader(record: Rec): void {
    this.out.string(record.name);
    this.optionalField(record.property, node => this.xml(node));
  }

  private transform(value: unknown): void {
    const transform = checkObject(value, "transform");
    const basis = checkArray(transform.basis, "transform.basis");
    if (basis.length !== 3) fail("transform.basis 需要 3 个 vec3。");
    for (const row of basis) this.out.vec3(row);
    this.out.vec3(transform.position);
    this.out.vec3(transform.scale);
  }

  private dummy(record: Rec, withOrdinal: boolean): void {
    this.trackObjectHeader(record);
    this.transform(record.transform);
    if (withOrdinal) this.out.uint32(record.instanceOrdinal);
  }

  private blackPlane(record: Rec): void {
    this.trackObjectHeader(record);
    this.vec3List(record.vertices, "ToBlackPlane.vertices", 4);
    this.out.vec3(record.planeNormal);
    const edges = checkArray(record.edgeEnabled, "edgeEnabled");
    if (edges.length !== 4) fail("edgeEnabled 需要 4 项。");
    for (const edge of edges) this.out.uint8(edge);
  }

  private minimap(record: Rec): void {
    this.trackObjectHeader(record);
    this.out.float32(record.centerX);
    this.out.float32(record.centerY);
    this.out.float32(record.scale);
    this.out.uint32(record.canvasWidth);
    this.out.uint32(record.canvasHeight);
    this.out.uint32(record.padding);
  }

  private mesh(record: Rec): void {
    this.trackObjectHeader(record);
    const indices = checkArray(record.indices, "ToMesh.indices");
    this.out.uint16(indices.length);
    for (const index of indices) this.out.uint16(index);
    const positions = checkArray(record.positions, "ToMesh.positions");
    this.out.uint16(positions.length);
    for (const item of positions) this.out.vec3(item);
  }

  private movableObject(record: Rec): void {
    this.trackObjectHeader(record);
    this.transform(record.transform);
    this.object(record.object);
    this.out.uint32(record.instanceOrdinal);
  }

  private triples(list: unknown, label: string): void {
    const items = checkArray(list, label);
    this.out.uint32(items.length);
    for (const item of items) {
      const triple = checkArray(item, label);
      if (triple.length !== 3) fail(`${label} 每项需要 3 个 uint16。`);
      for (const value of triple) this.out.uint16(value);
    }
  }

  private road(record: Rec): void {
    this.trackObjectHeader(record);
    this.out.uint8(record.cyclic ? 1 : 0);
    const records = checkArray(record.records, "ToRoad.records");
    this.out.uint32(records.length);
    for (const item of records) {
      this.out.string(item.name);
      const positions = checkArray(item.positions, "ToRoad.positions");
      this.out.uint32(positions.length);
      for (const position of positions) this.out.vec3(position);
      this.triples(item.gateIndices, "ToRoad.gateIndices");
      this.out.string(item.surface);
      this.triples(item.surfaceIndices, "ToRoad.surfaceIndices");
      const frames = checkArray(item.frames, "ToRoad.frames");
      this.out.uint32(frames.length);
      for (const frame of frames) {
        this.out.vec3(frame.position);
        this.out.vec3(frame.storedForward);
        this.out.vec3(frame.up);
      }
    }
  }

  private texture(record: Rec): void {
    this.out.uint32(record.textureOp);
    if (record.name === undefined || record.name === null) {
      this.out.uint8(0);
    } else {
      if (typeof record.name !== "string") fail("texture.name 必须是字符串。");
      this.out.uint8(1);
      const occurrence = record.nameOccurrence;
      const key = occurrence && typeof occurrence === "object" &&
        Number.isInteger(occurrence.id)
        ? `${occurrence.id}\u0000${record.name}` : `\u0000${record.name}`;
      this.field(key, () => this.out.string(record.name));
    }
    this.out.uint32(record.addressU);
    this.out.uint32(record.addressV);
    this.out.uint32(record.minFilter);
    this.out.uint32(record.magFilter);
    this.out.uint32(record.mipFilter);
    this.out.uint32(record.maxAnisotropy);
    const controllers = record.uvControllers === undefined ? [] :
      checkArray(record.uvControllers, "uvControllers");
    if (controllers.length > 5) fail("uvControllers 最多 5 项。");
    for (let index = 0; index < 5; index++) this.optionalObject(controllers[index]);
    this.out.float32(record.scalar);
    this.optionalObject(record.alphaController);
    this.optionalField(record.property, node => this.xml(node));
  }

  private material(record: Rec): void {
    this.out.uint32(record.mode);
    this.out.uint32(record.ambient);
    this.out.uint32(record.diffuse);
    this.out.uint32(record.specular);
    this.out.float32(record.power);
    this.out.uint8(record.reserved);
    this.out.uint32(record.emissive);
    const controllers = record.controllers === undefined ? [] :
      checkArray(record.controllers, "material.controllers");
    if (controllers.length > 4) fail("material.controllers 最多 4 项。");
    for (let index = 0; index < 4; index++) this.optionalObject(controllers[index]);
  }

  private controllerBase(value: unknown): void {
    const base = checkObject(value, "controller.base");
    this.out.uint32(base.controllerBaseWord0);
    this.out.uint32(base.cycleMode);
    const discarded = checkArray(base.readerDiscardedWords, "readerDiscardedWords");
    if (discarded.length !== 2) fail("readerDiscardedWords 需要 2 项。");
    this.out.uint32(discarded[0]);
    this.out.uint32(discarded[1]);
    this.out.float32(base.frequency);
    this.out.uint32(base.phaseWord);
    this.out.uint32(base.startTimeWord);
    this.out.uint32(base.stopTimeWord);
  }

  private records(list: unknown, size: number, label: string): void {
    const records = checkArray(list, `${label}关键帧`);
    this.out.uint32(records.length);
    for (const item of records) {
      if (item.length !== size) fail(`${label}关键帧每条需要 ${size} 字节。`);
      this.out.bytes(item);
    }
  }

  /** Q5: scalar key list. */
  private scalarKeys(value: unknown, label: string): void {
    const keys = checkObject(value, `${label}关键帧`);
    const type = checkInt(keys.type, 0xffffffff, `${label}关键帧类型`);
    const size = SCALAR_KEY_SIZES[type];
    if (size === undefined) fail(`${label}关键帧类型 ${type} 无原版 reader 分支。`);
    this.out.uint32(type);
    this.records(keys.records, size, label);
  }

  /** VisController / IntController: one fixed type and record size. */
  private fixedKeys(value: unknown, type: number, size: number, label: string): void {
    const keys = checkObject(value, `${label}关键帧`);
    if (keys.type !== type) fail(`${label}关键帧类型必须是 ${type}。`);
    this.out.uint32(type);
    this.records(keys.records, size, label);
  }

  /** Ep: vec3 keys, with the type-5 split-component form. */
  private vec3Keys(value: unknown): void {
    const keys = checkObject(value, "向量关键帧");
    const type = checkInt(keys.type, 0xffffffff, "向量关键帧类型");
    this.out.uint32(type);
    if (type === 5) {
      this.out.uint32(keys.count);
      const header = checkArray(keys.header, "向量关键帧 header");
      if (header.length !== 4) fail("向量关键帧 header 需要 4 项。");
      for (const word of header) this.out.uint32(word);
      const components = checkArray(keys.components, "向量关键帧 components");
      if (components.length !== 3) fail("向量关键帧 components 需要 3 项。");
      for (const component of components) this.scalarKeys(component, "向量分量");
      return;
    }
    const size = VEC3_KEY_SIZES[type];
    if (size === undefined) fail(`向量关键帧类型 ${type} 无原版 reader 分支。`);
    this.records(keys.records, size, "向量");
  }

  /** zH: rotation keys, with the type-4 per-axis form. */
  private rotationKeys(value: unknown): void {
    const keys = checkObject(value, "旋转关键帧");
    const type = checkInt(keys.type, 0xffffffff, "旋转关键帧类型");
    this.out.uint32(type);
    if (type === 4) {
      this.out.uint32(keys.count);
      const header = checkArray(keys.header, "旋转关键帧 header");
      if (header.length !== 5) fail("旋转关键帧 header 需要 5 项。");
      for (const word of header) this.out.uint32(word);
      const axes = checkArray(keys.axes, "旋转关键帧 axes");
      if (axes.length !== 3) fail("旋转关键帧 axes 需要 3 项。");
      for (const axis of axes) this.scalarKeys(axis, "旋转轴");
      return;
    }
    const size = ROTATION_KEY_SIZES[type];
    if (size === undefined) fail(`旋转关键帧类型 ${type} 无原版 reader 分支。`);
    this.records(keys.records, size, "旋转");
  }

  private prs(record: Rec): void {
    this.controllerBase(record.base);
    this.optionalField(record.position, keys => this.vec3Keys(keys));
    this.optionalField(record.rotation, keys => this.rotationKeys(keys));
    this.optionalField(record.scale, keys => this.vec3Keys(keys));
    const cache = checkArray(record.firstLastCache, "firstLastCache");
    if (cache.length !== 6) fail("firstLastCache 需要 6 项。");
    for (const word of cache) this.out.uint32(word);
  }

  private morph(record: Rec): void {
    this.controllerBase(record.base);
    this.field(checkObject(record.data, "morph.data"), () => {
      const data = checkArray(record.data, "morph.data");
      this.out.uint32(data.length);
      for (const item of data) {
        const count = checkInt(item.vertexCount, 65535, "Morph vertexCount");
        this.out.uint16(count);
        const optionalList = (list: unknown, label: string, write: (value: any) => void) => {
          if (list === undefined || list === null) { this.out.uint8(0); return; }
          const items = checkArray(list, label);
          if (items.length !== count) fail(`${label} 需要 ${count} 项。`);
          this.out.uint8(1);
          for (const value of items) write(value);
        };
        optionalList(item.positions, "Morph positions", value => this.out.vec3(value));
        optionalList(item.normals, "Morph normals", value => this.out.vec3(value));
        optionalList(item.scalars, "Morph scalars", value => this.out.float32(value));
        optionalList(item.uvs, "Morph uvs", value => this.out.vec2(value));
        this.field(checkObject(item.keys, "Morph keys"), () => this.scalarKeys(item.keys, "Morph"));
      }
    });
  }

  private path(record: Rec): void {
    this.controllerBase(record.base);
    this.optionalField(record.vec3Keys, keys => this.vec3Keys(keys));
    this.optionalField(record.floatKeys, keys => this.scalarKeys(keys, "路径"));
    this.out.uint32(record.tailDword0);
    this.out.uint32(record.tailDword1);
    this.out.uint16(record.tailWord0);
    this.out.uint32(record.tailDword2);
    this.out.uint16(record.tailWord1);
    const tail = record.tailBytes;
    if (!tail || tail.length !== 5) fail("path-controller tailBytes 需要 5 字节。");
    this.out.bytes(tail);
  }

  xml(node: Rec, depth = 0): void {
    if (depth > 128) fail("二进制 XML 层级过深。");
    this.out.string(node.name);
    this.out.string(node.text ?? "");
    const attributes = node.attributes === undefined ? [] :
      checkArray(node.attributes, "XML attributes");
    this.out.uint32(attributes.length);
    for (const attribute of attributes) {
      this.out.string(attribute.name);
      this.out.string(attribute.value);
    }
    const children = node.children === undefined ? [] : checkArray(node.children, "XML children");
    this.out.uint32(children.length);
    for (const child of children) this.xml(checkObject(child, "XML child"), depth + 1);
  }
}

/**
 * Encode a parsed or built track model. `root` is the `y9(bytes).root` shape:
 * a TrackContainer (`kind: "track"`) or a bare Relement scene (`kind: "node"`).
 */
export function encodeTrackModel(root: TrackContainer | TrackNode): Uint8Array {
  const record = checkObject(root, "根对象");
  if (record.kind !== "track" && record.kind !== "node")
    fail(".1s 根对象必须是 TrackContainer 或 Relement。");
  const encoder = new TrackModelEncoder();
  encoder.object(record);
  return encoder.out.finish();
}

/** Encode one binary XML node (the `L6` layout) on its own, e.g. for tests. */
export function encodeTrackXml(node: TrackXmlNode): Uint8Array {
  const encoder = new TrackModelEncoder();
  encoder.xml(node);
  return encoder.out.finish();
}

// ---------------------------------------------------------------------------
// Builder helpers: minimal decoder-shaped objects for generated content.

function vec3(value: ArrayLike<number> | undefined, fallback: Vec3): Vec3 {
  return value ? [value[0]!, value[1]!, value[2]!] : [...fallback] as Vec3;
}

/** A Relement-family node with the same defaults the decoder's `qH` uses. */
export function makeNode(className: TrackNodeClassName,
  fields: Partial<TrackNode> = {}): TrackNode {
  if (NODE_STAMPS[className] === undefined) fail(`不支持的节点类名 ${className}。`);
  const node: TrackNode = {
    kind: "node",
    className,
    name: "",
    children: [],
    transform: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    position: [0, 0, 0],
    scale: [1, 1, 1],
    bounds0: { min: [0, 0, 0], max: [0, 0, 0] },
    serializedBoundsOverride: 0,
    cullingTraversalMode: 0,
    bounds1: { min: [0, 0, 0], max: [0, 0, 0] },
    rawScalar: 0,
    nodeEnabled: 1,
    slots: Array.from({ length: 11 }),
    slotOccurrences: Array.from({ length: 11 }),
    ...fields,
  };
  if (node.slots.length !== 11) {
    const slots = Array.from({ length: 11 }, (_, index) => node.slots[index]);
    node.slots = slots;
  }
  return node;
}

/** Place a property / controller into the slot its kind belongs to. */
export function setNodeProperty(node: TrackNode, property: TrackProperty): TrackNode {
  const slot = (NODE_SLOT as Record<string, number | undefined>)[property.kind];
  if (slot === undefined) fail(`${property.kind} 没有对应的节点 slot。`);
  node.slots[slot] = property;
  return node;
}

export interface VertexDataInput {
  positions?: ReadonlyArray<ArrayLike<number>>;
  normals?: ReadonlyArray<ArrayLike<number>>;
  diffuseColors?: ReadonlyArray<number>;
  /** One UV per vertex (`uvs[vertex]`) or several sets (`uvs[vertex][set]`). */
  uvs?: ReadonlyArray<ArrayLike<number> | ReadonlyArray<ArrayLike<number>>>;
  indices: ReadonlyArray<number>;
  property?: TrackProperty;
}

/** Vertex buffer of a ReTriList / ReTriStrip, deriving the counts. */
export function makeVertexData(input: VertexDataInput): TrackVertexData {
  const vertexCount = input.positions?.length ?? input.normals?.length ??
    input.diffuseColors?.length ?? input.uvs?.length ?? 0;
  const uvs: Vec2[][] = (input.uvs ?? Array.from({ length: vertexCount }, () => []))
    .map(vertex => {
      const sets = typeof (vertex as ArrayLike<number>)[0] === "number"
        ? [vertex as ArrayLike<number>] : vertex as ReadonlyArray<ArrayLike<number>>;
      return sets.map(uv => [uv[0]!, uv[1]!] as Vec2);
    });
  if (uvs.length !== vertexCount) fail(`uvs 需要 ${vertexCount} 项。`);
  const uvSetsPerVertex = uvs[0]?.length ?? 0;
  if (uvs.some(sets => sets.length !== uvSetsPerVertex)) fail("每个顶点的 UV 组数必须一致。");
  const data: TrackVertexData = {
    vertexCount,
    positions: input.positions?.map(item => vec3(item, [0, 0, 0])),
    normals: input.normals?.map(item => vec3(item, [0, 0, 0])),
    diffuseColors: input.diffuseColors ? [...input.diffuseColors] : undefined,
    uvSetsPerVertex,
    uvs,
    property: input.property,
    indices: [...input.indices],
  };
  if (data.positions === undefined) delete data.positions;
  if (data.normals === undefined) delete data.normals;
  if (data.diffuseColors === undefined) delete data.diffuseColors;
  if (data.property === undefined) delete data.property;
  return data;
}

export interface TriListNodeOptions {
  className?: "ReTriList" | "ReTriStrip";
  /** Properties placed into their kind's slot (texture, alpha, backface, zbuffer, material, ...). */
  properties?: ReadonlyArray<TrackProperty>;
  sortDepthBias?: number;
  children?: TrackNode[];
  transform?: [Vec3, Vec3, Vec3];
  position?: Vec3;
  scale?: Vec3;
  /** Defaults to the axis-aligned box of `vertexData.positions`. */
  bounds0?: TrackBounds;
  bounds1?: TrackBounds;
  serializedBoundsOverride?: number;
  cullingTraversalMode?: number;
  rawScalar?: number;
  nodeEnabled?: number;
  additionalProperty?: TrackXmlNode;
}

/** A ReTriList (default) or ReTriStrip leaf with its vertex data and slot properties. */
export function makeTriListNode(name: string, vertexData: TrackVertexData,
  options: TriListNodeOptions = {}): TrackNode {
  const { className = "ReTriList", properties = [], ...fields } = options;
  const node = makeNode(className, { name, sortDepthBias: 0, vertexData, ...fields });
  for (const property of properties) setNodeProperty(node, property);
  if (!fields.bounds0 && vertexData.positions && vertexData.positions.length > 0) {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const position of vertexData.positions) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, position[axis]!);
        max[axis] = Math.max(max[axis]!, position[axis]!);
      }
    }
    node.bounds0 = { min, max };
  }
  return node;
}

export interface TexPropertyOptions {
  textureOp?: number;
  addressU?: number;
  addressV?: number;
  minFilter?: number;
  magFilter?: number;
  mipFilter?: number;
  maxAnisotropy?: number;
  scalar?: number;
  uvControllers?: ReadonlyArray<TrackProperty | undefined>;
  alphaController?: TrackProperty;
  property?: TrackXmlNode;
}

/** TexProperty with the values most original track meshes use (wrap, linear filters). */
export function makeTexProperty(name: string, options: TexPropertyOptions = {}): TexProperty {
  const texture: TexProperty = {
    kind: "texture",
    textureOp: options.textureOp ?? 1,
    name,
    addressU: options.addressU ?? 1,
    addressV: options.addressV ?? 1,
    minFilter: options.minFilter ?? 2,
    magFilter: options.magFilter ?? 2,
    mipFilter: options.mipFilter ?? 2,
    maxAnisotropy: options.maxAnisotropy ?? 1,
    uvControllers: Array.from({ length: 5 }, (_, index) => options.uvControllers?.[index]),
    scalar: options.scalar ?? 1,
  };
  if (options.alphaController) texture.alphaController = options.alphaController;
  if (options.property) texture.property = options.property;
  return texture;
}

/** AlphaProperty; the default is the common opaque alpha-test (ref 127) state. */
export function makeAlphaProperty(options: Partial<Omit<AlphaProperty, "kind">> = {}): AlphaProperty {
  return {
    kind: "alpha",
    blendEnable: options.blendEnable ?? 0,
    srcBlend: options.srcBlend ?? 5,
    dstBlend: options.dstBlend ?? 6,
    alphaTestEnable: options.alphaTestEnable ?? 1,
    compare: options.compare ?? 5,
    alphaRef: options.alphaRef ?? 127,
  };
}

export function makeBackFaceProperty(cull: number): BackFaceProperty {
  return { kind: "backface", cull };
}

export function makeZBufProperty(zFunc = 4, zWrite = 1): ZBufProperty {
  return { kind: "zbuffer", zFunc, zWrite };
}

/** Binary XML node; attributes may be given as an object or a name/value list. */
export function makeXml(name: string,
  attributes: Readonly<Record<string, string>> | ReadonlyArray<TrackXmlAttribute> = {},
  children: ReadonlyArray<TrackXmlNode> = [], text = ""): TrackXmlNode {
  const list = Array.isArray(attributes)
    ? (attributes as ReadonlyArray<TrackXmlAttribute>).map(item => ({ name: item.name, value: item.value }))
    : Object.entries(attributes as Record<string, string>).map(([key, value]) => ({ name: key, value }));
  return { name, text, attributes: list, children: [...children] };
}

export function makeTrackContainer(name: string, scene: TrackNode,
  trackObjects: ReadonlyArray<TrackObjectRecord> = []): TrackContainer {
  return { kind: "track", name, scene, trackObjects: [...trackObjects] };
}
